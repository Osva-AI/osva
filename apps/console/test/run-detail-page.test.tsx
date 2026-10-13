import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunDetailPage } from "../src/client/routes/run-detail-page";
import { MAX_ARTIFACT_PREVIEW_BYTES } from "../src/client/lib/artifact-preview";

const digest = `sha256:${"a".repeat(64)}`;

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-md",
    name: "report.md",
    mediaType: "text/markdown",
    sizeBytes: 24,
    digest,
    createdAt: "2026-01-01T00:00:00.000Z",
    metadata: { kind: "osva.canonical.dependency-adoption-review" },
    producer: { runId: "run-1", runAttemptId: "ra-1" },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderRunDetail(path = "/runs/run-1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunDetailPage />} />
          <Route
            path="/runs/:runId/attempts/:runAttemptId"
            element={<RunDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubRunFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      return handler(url, init);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function defaultRunResponses(
  url: string,
  artifacts: unknown[],
): Response | undefined {
  if (url.includes("/api/v1/runs/run-1/attempts/ra-1/steps")) {
    return jsonResponse({ steps: [] });
  }
  if (url.includes("/api/v1/runs/run-1/attempts/ra-1/usage")) {
    return jsonResponse({
      modelCalls: 0,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      estimatedCostUsdMicros: null,
      pricedModelCalls: 0,
      unpricedModelCalls: 0,
    });
  }
  if (url.includes("/api/v1/runs/run-1/attempts/ra-1")) {
    return jsonResponse({
      id: "ra-1",
      runId: "run-1",
      sequence: 1,
      status: "SUCCEEDED",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      output: { ok: true },
      execution: {
        state: "completed",
        leased: false,
        executionGeneration: 1,
        interrupted: false,
        observedAt: "2026-01-01T00:00:01.000Z",
      },
    });
  }
  if (url.includes("/api/v1/runs/run-1/attempts")) {
    return jsonResponse({
      attempts: [
        {
          id: "ra-1",
          runId: "run-1",
          sequence: 1,
          status: "SUCCEEDED",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
  }
  if (url.match(/\/api\/v1\/runs\/run-1$/)) {
    return jsonResponse({
      id: "run-1",
      agentId: "agent-1",
      status: "SUCCEEDED",
      effectiveBindings: {
        agentVersionId: "av-1",
        modelProfileVersionBindings: {},
        toolVersionBindings: {},
      },
      input: { prompt: "hello" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
  }
  if (url.includes("/api/v1/artifacts?")) {
    return jsonResponse({ items: artifacts });
  }
  return undefined;
}

describe("RunDetailPage artifacts", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists artifact metadata without fetching content until Preview is clicked", async () => {
    const fetchMock = stubRunFetch((url) => {
      const fallback = defaultRunResponses(url, [artifact()]);
      if (fallback !== undefined) {
        return fallback;
      }
      throw new Error(`unexpected ${url}`);
    });

    renderRunDetail();

    await waitFor(() => {
      expect(screen.getByText("report.md")).toBeTruthy();
    });
    expect(
      screen.getByText(/Individual Run \(not a WorkflowRun\)/),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "agent-1" }).getAttribute("href"),
    ).toBe("/agents/agent-1");
    expect(
      screen.getByRole("link", { name: "av-1" }).getAttribute("href"),
    ).toBe("/agents/agent-1/versions/av-1");
    expect(screen.getByText("text/markdown")).toBeTruthy();
    expect(screen.getByText("24 B")).toBeTruthy();
    expect(screen.getByTitle(digest)).toBeTruthy();
    expect(screen.getByRole("link", { name: "run-1" })).toBeTruthy();
    expect(
      fetchMock.mock.calls.every(([url]) => !String(url).includes("/content")),
    ).toBe(true);
  });

  it("renders markdown as escaped text and never HTML", async () => {
    stubRunFetch((url) => {
      const fallback = defaultRunResponses(url, [artifact()]);
      if (fallback !== undefined) {
        return fallback;
      }
      if (url.endsWith("/api/v1/artifacts/artifact-md/content")) {
        return new Response(
          "# Title\n<script>alert(1)</script>\n<a href='x'>link</a>",
          { status: 200 },
        );
      }
      throw new Error(`unexpected ${url}`);
    });

    const { container } = renderRunDetail();
    await waitFor(() => {
      expect(screen.getByText("report.md")).toBeTruthy();
    });
    await userEvent.click(screen.getByLabelText("Preview report.md"));
    await waitFor(() => {
      expect(screen.getByText(/alert\(1\)/)).toBeTruthy();
    });
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a[href='x']")).toBeNull();
  });

  it("does not fetch content for HTML or SVG artifacts", async () => {
    const fetchMock = stubRunFetch((url) => {
      const fallback = defaultRunResponses(url, [
        artifact({
          id: "artifact-html",
          name: "page.html",
          mediaType: "text/html",
        }),
        artifact({
          id: "artifact-svg",
          name: "icon.svg",
          mediaType: "image/svg+xml",
        }),
      ]);
      if (fallback !== undefined) {
        return fallback;
      }
      throw new Error(`unexpected ${url}`);
    });

    renderRunDetail();
    await waitFor(() => {
      expect(screen.getByText("page.html")).toBeTruthy();
    });

    await userEvent.click(
      screen.getByLabelText("Why page.html cannot be previewed"),
    );
    await waitFor(() => {
      expect(
        screen.getByText(/Preview is not available for this media type/),
      ).toBeTruthy();
    });
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/content")),
    ).toBe(false);

    await userEvent.click(
      screen.getByLabelText("Why icon.svg cannot be previewed"),
    );
    await waitFor(() => {
      expect(screen.getAllByText(/Preview is not available/).length).toBe(1);
    });
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/content")),
    ).toBe(false);
  });

  it("formats valid JSON and falls back for invalid JSON", async () => {
    stubRunFetch((url) => {
      const fallback = defaultRunResponses(url, [
        artifact({
          id: "artifact-json",
          name: "data.json",
          mediaType: "application/json",
        }),
      ]);
      if (fallback !== undefined) {
        return fallback;
      }
      if (url.endsWith("/api/v1/artifacts/artifact-json/content")) {
        return new Response('{"ok":true}', { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });

    renderRunDetail();
    await waitFor(() => {
      expect(screen.getByText("data.json")).toBeTruthy();
    });
    await userEvent.click(screen.getByLabelText("Preview data.json"));
    await waitFor(() => {
      expect(screen.getByText("JSON preview")).toBeTruthy();
    });
    const preview = screen.getByTestId("artifact-preview-panel");
    expect(preview.textContent).toMatch(/"ok": true/);
  });

  it("shows raw text when JSON preview content is invalid", async () => {
    stubRunFetch((url) => {
      const fallback = defaultRunResponses(url, [
        artifact({
          id: "artifact-bad-json",
          name: "bad.json",
          mediaType: "application/json",
        }),
      ]);
      if (fallback !== undefined) {
        return fallback;
      }
      if (url.endsWith("/api/v1/artifacts/artifact-bad-json/content")) {
        return new Response("not-json", { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });

    renderRunDetail();
    await waitFor(() => {
      expect(screen.getByText("bad.json")).toBeTruthy();
    });
    await userEvent.click(screen.getByLabelText("Preview bad.json"));
    await waitFor(() => {
      expect(screen.getByText(/not valid JSON/)).toBeTruthy();
    });
    expect(screen.getByText("not-json")).toBeTruthy();
  });

  it("does not request content when metadata size exceeds the preview limit", async () => {
    const fetchMock = stubRunFetch((url) => {
      const fallback = defaultRunResponses(url, [
        artifact({
          sizeBytes: MAX_ARTIFACT_PREVIEW_BYTES + 20,
        }),
      ]);
      if (fallback !== undefined) {
        return fallback;
      }
      throw new Error(`unexpected ${url}`);
    });

    renderRunDetail();
    await waitFor(() => {
      expect(screen.getByText("report.md")).toBeTruthy();
    });
    await userEvent.click(
      screen.getByLabelText("Why report.md cannot be previewed"),
    );
    await waitFor(() => {
      expect(screen.getByText(/512 KiB preview limit/)).toBeTruthy();
    });
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/content")),
    ).toBe(false);
  });

  it("keeps an open preview across artifact list polling", async () => {
    let artifactCalls = 0;
    stubRunFetch((url) => {
      if (url.includes("/api/v1/artifacts?")) {
        artifactCalls += 1;
        return jsonResponse({
          items: [artifact({ name: `report.md` })],
        });
      }
      const fallback = defaultRunResponses(url, []);
      if (fallback !== undefined) {
        return fallback;
      }
      if (url.endsWith("/api/v1/artifacts/artifact-md/content")) {
        return new Response("stable preview", { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });

    renderRunDetail();
    await waitFor(() => {
      expect(screen.getByText("report.md")).toBeTruthy();
    });
    await userEvent.click(screen.getByLabelText("Preview report.md"));
    await waitFor(() => {
      expect(screen.getByText("stable preview")).toBeTruthy();
    });
    const callsBefore = artifactCalls;
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => {
      expect(artifactCalls).toBeGreaterThan(callsBefore);
    });
    expect(screen.getByText("stable preview")).toBeTruthy();
  });

  it("does not show stale preview text after switching artifacts", async () => {
    let resolveFirst: ((value: Response) => void) | undefined;
    stubRunFetch((url) => {
      const fallback = defaultRunResponses(url, [
        artifact({ id: "artifact-a", name: "a.md" }),
        artifact({ id: "artifact-b", name: "b.md" }),
      ]);
      if (fallback !== undefined) {
        return fallback;
      }
      if (url.endsWith("/api/v1/artifacts/artifact-a/content")) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      if (url.endsWith("/api/v1/artifacts/artifact-b/content")) {
        return new Response("content-b", { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });

    renderRunDetail();
    await waitFor(() => {
      expect(screen.getByText("a.md")).toBeTruthy();
    });
    await userEvent.click(screen.getByLabelText("Preview a.md"));
    await userEvent.click(screen.getByLabelText("Preview b.md"));
    await waitFor(() => {
      expect(screen.getByText("content-b")).toBeTruthy();
    });
    resolveFirst?.(new Response("content-a", { status: 200 }));
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(screen.queryByText("content-a")).toBeNull();
    expect(screen.getByText("content-b")).toBeTruthy();
  });

  it("cancels preview when the panel is closed", async () => {
    const abortSignals: AbortSignal[] = [];
    stubRunFetch((url, init) => {
      const fallback = defaultRunResponses(url, [artifact()]);
      if (fallback !== undefined) {
        return fallback;
      }
      if (url.endsWith("/api/v1/artifacts/artifact-md/content")) {
        if (init?.signal != null) {
          abortSignals.push(init.signal);
        }
        return new Promise<Response>(() => {
          // Stay pending until cancelled.
        });
      }
      throw new Error(`unexpected ${url}`);
    });

    renderRunDetail();
    await waitFor(() => {
      expect(screen.getByText("report.md")).toBeTruthy();
    });
    await userEvent.click(screen.getByLabelText("Preview report.md"));
    await waitFor(() => {
      expect(screen.getByText("Loading preview…")).toBeTruthy();
    });
    await userEvent.click(screen.getByLabelText("Close preview of report.md"));
    await waitFor(() => {
      expect(screen.queryByTestId("artifact-preview-panel")).toBeNull();
    });
    expect(abortSignals[0]?.aborted).toBe(true);
  });

  it("uses the same-origin BFF download URL with the artifact name", async () => {
    stubRunFetch((url) => {
      const fallback = defaultRunResponses(url, [artifact()]);
      if (fallback !== undefined) {
        return fallback;
      }
      throw new Error(`unexpected ${url}`);
    });

    renderRunDetail();
    await waitFor(() => {
      expect(screen.getByText("report.md")).toBeTruthy();
    });
    const download = screen.getByLabelText("Download report.md");
    expect(download.getAttribute("href")).toBe(
      "/api/v1/artifacts/artifact-md/content",
    );
    expect(download.getAttribute("download")).toBe("report.md");
    expect(download.getAttribute("href")).not.toContain("s3://");
    expect(download.getAttribute("href")).not.toContain("apiKey");
  });

  it("shows 403, 404, and 503 preview errors without storage paths", async () => {
    stubRunFetch((url) => {
      const fallback = defaultRunResponses(url, [artifact()]);
      if (fallback !== undefined) {
        return fallback;
      }
      if (url.endsWith("/api/v1/artifacts/artifact-md/content")) {
        return jsonResponse(
          { error: "Requested resource is unavailable.", code: "unavailable" },
          503,
        );
      }
      throw new Error(`unexpected ${url}`);
    });

    renderRunDetail();
    await waitFor(() => {
      expect(screen.getByText("report.md")).toBeTruthy();
    });
    await userEvent.click(screen.getByLabelText("Preview report.md"));
    await waitFor(() => {
      expect(screen.getByText("Artifact content is unavailable.")).toBeTruthy();
    });
    expect(screen.queryByText(/\.osva\/artifacts/)).toBeNull();
  });

  it("keeps existing run navigation and attempt output", async () => {
    stubRunFetch((url) => {
      const fallback = defaultRunResponses(url, []);
      if (fallback !== undefined) {
        return fallback;
      }
      throw new Error(`unexpected ${url}`);
    });

    renderRunDetail();
    await waitFor(() => {
      expect(screen.getByText("No artifacts produced.")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: "Back to runs" })).toBeTruthy();
    expect(screen.queryByText("No output recorded yet.")).toBeNull();
    expect(screen.getByText("Output")).toBeTruthy();
  });

  it("renders execution diagnostics for an interrupted attempt without owner secrets", async () => {
    stubRunFetch((url) => {
      if (
        url.includes("/api/v1/runs/run-1/attempts/ra-1") &&
        !url.includes("/steps") &&
        !url.includes("/usage")
      ) {
        return jsonResponse({
          id: "ra-1",
          runId: "run-1",
          sequence: 1,
          status: "FAILED",
          createdAt: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:01.000Z",
          error: {
            code: "EXECUTION_INTERRUPTED",
            message: "Execution lease expired; worker ownership was lost.",
          },
          execution: {
            state: "interrupted",
            leased: false,
            leaseExpiresAt: "2026-01-01T00:00:00.500Z",
            executionGeneration: 2,
            interrupted: true,
            recoveryReason: "LEASE_EXPIRED",
            observedAt: "2026-01-01T00:00:02.000Z",
          },
        });
      }
      const fallback = defaultRunResponses(url, []);
      if (fallback !== undefined) {
        return fallback;
      }
      throw new Error(`unexpected ${url}`);
    });

    renderRunDetail("/runs/run-1/attempts/ra-1");
    await waitFor(() => {
      expect(screen.getByTestId("execution-diagnostics")).toBeTruthy();
    });
    expect(screen.getByText("Execution interrupted")).toBeTruthy();
    expect(screen.getByText("LEASE_EXPIRED")).toBeTruthy();
    expect(screen.getByText(/PostgreSQL/)).toBeTruthy();
    expect(screen.queryByText(/worker-secret/)).toBeNull();
    expect(screen.queryByText(/postgres:\/\//)).toBeNull();
  });
});
