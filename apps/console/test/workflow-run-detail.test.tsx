import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stubHumanSessionFetch } from "./human-auth-fetch-stub.js";

import { WorkflowRunDetailPage } from "../src/client/routes/workflow-run-detail-page";

vi.mock("../src/client/components/workflow/workflow-graph-view", () => ({
  WorkflowGraphView: (props: {
    readonly executionStatusByNodeKey?: Readonly<Record<string, string>>;
    readonly edgeAppearanceById?: Readonly<Record<string, string>>;
    readonly onNodeSelect?: (nodeKey: string | undefined) => void;
  }) => (
    <div data-testid="workflow-graph-view-mock">
      {Object.entries(props.executionStatusByNodeKey ?? {}).map(
        ([key, status]) => (
          <button
            key={key}
            type="button"
            onClick={() => props.onNodeSelect?.(key)}
          >
            overlay {key} {status}
          </button>
        ),
      )}
      {Object.entries(props.edgeAppearanceById ?? {}).map(
        ([edgeId, appearance]) => (
          <div key={edgeId}>{`edge ${edgeId} ${appearance}`}</div>
        ),
      )}
    </div>
  ),
}));

const definition = {
  schemaVersion: "3",
  nodes: [
    {
      key: "agent",
      type: "AGENT",
      agentVersionId: "av-1",
    },
    {
      key: "approval",
      type: "APPROVAL",
      title: "Review output",
      description: "Check before continuing",
    },
    {
      key: "wait-event",
      type: "WAIT",
      wait: {
        kind: "EVENT",
        source: "billing",
        eventType: "invoice.paid",
        correlation: { kind: "LITERAL", value: "inv-1" },
      },
    },
  ],
  edges: [
    { from: "agent", to: "approval" },
    { from: "approval", to: "wait-event" },
  ],
};

function emptyArtifactListOrNotFound(url: string): Response {
  if (url.includes("/api/v1/artifacts?")) {
    return Response.json({ items: [] });
  }
  return Response.json({ error: "not found" }, { status: 404 });
}

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/workflow-runs/wr-1"]}>
        <Routes>
          <Route
            path="/workflow-runs/:workflowRunId"
            element={<WorkflowRunDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WorkflowRunDetailPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("combines definition and node runs with operator actions", async () => {
    const fetchMock = stubHumanSessionFetch("OPERATOR", "ws-1", (url, init) => {
      if (url.includes("/api/v1/workflows/wf-1/versions/wv-1")) {
        return new Response(
          JSON.stringify({
            id: "wv-1",
            workflowId: "wf-1",
            workspaceId: "ws-1",
            version: 1,
            definition,
            createdAt: "2026-01-01T00:00:00.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (
        url.includes("/api/v1/approval-requests/ar-1/decision") &&
        init?.method === "POST"
      ) {
        return new Response(
          JSON.stringify({
            id: "ar-1",
            workspaceId: "ws-1",
            workflowRunId: "wr-1",
            workflowNodeRunId: "wn-2",
            status: "APPROVED",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/workflow-runs/wr-1")) {
        return new Response(
          JSON.stringify({
            id: "wr-1",
            workspaceId: "ws-1",
            workflowId: "wf-1",
            workflowVersionId: "wv-1",
            status: "WAITING",
            input: { invoiceId: "inv-1" },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
            nodeRuns: [
              {
                id: "wn-1",
                workspaceId: "ws-1",
                workflowRunId: "wr-1",
                workflowNodeKey: "agent",
                sequence: 1,
                status: "SUCCEEDED",
                input: {},
                childRunId: "run-child-1",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:01.000Z",
              },
              {
                id: "wn-2",
                workspaceId: "ws-1",
                workflowRunId: "wr-1",
                workflowNodeKey: "approval",
                sequence: 2,
                status: "WAITING",
                input: {},
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:01.000Z",
              },
              {
                id: "wn-3",
                workspaceId: "ws-1",
                workflowRunId: "wr-1",
                workflowNodeKey: "wait-event",
                sequence: 3,
                status: "PENDING",
                input: {},
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:01.000Z",
              },
            ],
            approvalRequests: [
              {
                id: "ar-1",
                workspaceId: "ws-1",
                workflowRunId: "wr-1",
                workflowNodeRunId: "wn-2",
                status: "PENDING",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:01.000Z",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return undefined;
    });

    renderDetail();

    await waitFor(() => {
      expect(screen.getAllByText("Review output").length).toBeGreaterThan(0);
    });
    const executionHeading = screen.getByRole("heading", { name: "Execution" });
    const inputHeading = screen.getByRole("heading", { name: "Input" });
    expect(
      executionHeading.compareDocumentPosition(inputHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /run-child-1/ }).getAttribute("href"),
    ).toBe("/runs/run-child-1");
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Emit event" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).includes("/decision") && init?.method === "POST",
        ),
      ).toBe(true);
    });
  });

  it("shows emit event for waiting EVENT node and preserves request id on failure", async () => {
    stubHumanSessionFetch("OPERATOR", "ws-1", (url, init) => {
      if (url.includes("/api/v1/workflows/wf-1/versions/wv-1")) {
        return new Response(
          JSON.stringify({
            id: "wv-1",
            workflowId: "wf-1",
            workspaceId: "ws-1",
            version: 1,
            definition,
            createdAt: "2026-01-01T00:00:00.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/workflow-events") && init?.method === "POST") {
        return new Response(
          JSON.stringify({ error: "conflict", requestId: "req-event-9" }),
          {
            status: 409,
            headers: {
              "Content-Type": "application/json",
              "x-osva-request-id": "req-event-9",
            },
          },
        );
      }
      if (url.includes("/api/v1/workflow-runs/wr-1")) {
        return new Response(
          JSON.stringify({
            id: "wr-1",
            workspaceId: "ws-1",
            workflowId: "wf-1",
            workflowVersionId: "wv-1",
            status: "WAITING",
            input: {},
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
            nodeRuns: [
              {
                id: "wn-3",
                workspaceId: "ws-1",
                workflowRunId: "wr-1",
                workflowNodeKey: "wait-event",
                sequence: 3,
                status: "WAITING",
                input: {},
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:01.000Z",
              },
            ],
            approvalRequests: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return undefined;
    });

    renderDetail();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Emit event" })).toBeTruthy();
    });
    expect((screen.getByLabelText("Source") as HTMLInputElement).value).toBe(
      "billing",
    );
    expect(
      (screen.getByLabelText("Correlation key") as HTMLInputElement).value,
    ).toBe("inv-1");
    expect(
      screen.getByText(/does not force-resume the workflow/i),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Emit event" }));
    await waitFor(() => {
      expect(screen.getByText(/Request ID: req-event-9/)).toBeTruthy();
    });
    expect(
      screen.getByText(/Waiting for event billing\/invoice\.paid/),
    ).toBeTruthy();
  });

  it("overlays the latest node-run status and lists historical node records without inventing success", async () => {
    stubHumanSessionFetch("OPERATOR", "ws-1", (url) => {
      if (url.includes("/api/v1/workflows/wf-1/versions/wv-1")) {
        return Response.json({
          id: "wv-1",
          workflowId: "wf-1",
          workspaceId: "ws-1",
          version: 1,
          definition,
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      if (url.includes("/api/v1/workflow-runs/wr-1")) {
        return Response.json({
          id: "wr-1",
          workspaceId: "ws-1",
          workflowId: "wf-1",
          workflowVersionId: "wv-1",
          status: "RUNNING",
          input: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
          nodeRuns: [
            {
              id: "wn-old",
              workspaceId: "ws-1",
              workflowRunId: "wr-1",
              workflowNodeKey: "agent",
              sequence: 1,
              status: "FAILED",
              input: {},
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            {
              id: "wn-new",
              workspaceId: "ws-1",
              workflowRunId: "wr-1",
              workflowNodeKey: "agent",
              sequence: 2,
              status: "RUNNING",
              input: {},
              childRunId: "run-child-2",
              createdAt: "2026-01-01T00:00:01.000Z",
              updatedAt: "2026-01-01T00:00:02.000Z",
            },
          ],
          approvalRequests: [],
        });
      }
      return emptyArtifactListOrNotFound(url);
    });

    renderDetail();
    await waitFor(() => {
      expect(screen.getByText("overlay agent RUNNING")).toBeTruthy();
    });
    expect(screen.queryByText("overlay agent FAILED")).toBeNull();
    expect(screen.queryByText("overlay approval")).toBeNull();

    await userEvent.click(screen.getByText("overlay agent RUNNING"));
    await waitFor(() => {
      expect(screen.getByTestId("workflow-run-node-inspector")).toBeTruthy();
    });
    expect(screen.getAllByText(/Showing latest of 2 historical/).length).toBe(
      2,
    );
    expect(screen.getAllByText(/not RunAttempts/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/earlier attempts/i)).toBeNull();
    expect(screen.getAllByText(/wn-old · seq 1 · FAILED/).length).toBe(2);
    expect(
      screen
        .getAllByRole("link", { name: /run-child-2/ })[0]
        ?.getAttribute("href"),
    ).toBe("/runs/run-child-2");
  });

  it("shows Analysis consuming Research's persisted output", async () => {
    const researchOutput = {
      schemaVersion: "1",
      request: { packageName: "zod", requestId: "m8-4-handoff-001" },
      evidence: { latestVersion: "3.24.1" },
    };
    stubHumanSessionFetch("OPERATOR", "ws-1", (url) => {
      if (url.includes("/api/v1/workflows/wf-1/versions/wv-1")) {
        return Response.json({
          id: "wv-1",
          workflowId: "wf-1",
          workspaceId: "ws-1",
          version: 1,
          definition: {
            schemaVersion: "3",
            nodes: [
              { key: "research", type: "AGENT", agentVersionId: "av-research" },
              { key: "analysis", type: "AGENT", agentVersionId: "av-analysis" },
            ],
            edges: [{ from: "research", to: "analysis" }],
          },
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      if (url.includes("/api/v1/workflow-runs/wr-1")) {
        return Response.json({
          id: "wr-1",
          workspaceId: "ws-1",
          workflowId: "wf-1",
          workflowVersionId: "wv-1",
          status: "SUCCEEDED",
          input: {
            schemaVersion: "1",
            request: { packageName: "zod", requestId: "m8-4-handoff-001" },
          },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:02.000Z",
          nodeRuns: [
            {
              id: "wn-research",
              workspaceId: "ws-1",
              workflowRunId: "wr-1",
              workflowNodeKey: "research",
              sequence: 1,
              status: "SUCCEEDED",
              input: {
                schemaVersion: "1",
                request: { packageName: "zod", requestId: "m8-4-handoff-001" },
              },
              output: researchOutput,
              childRunId: "run-research",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:01.000Z",
            },
            {
              id: "wn-analysis",
              workspaceId: "ws-1",
              workflowRunId: "wr-1",
              workflowNodeKey: "analysis",
              sequence: 2,
              status: "SUCCEEDED",
              input: researchOutput,
              output: { disposition: "PILOT" },
              childRunId: "run-analysis",
              createdAt: "2026-01-01T00:00:01.000Z",
              updatedAt: "2026-01-01T00:00:02.000Z",
            },
          ],
          approvalRequests: [],
        });
      }
      return emptyArtifactListOrNotFound(url);
    });

    renderDetail();
    await waitFor(() => {
      expect(screen.getByText("overlay research SUCCEEDED")).toBeTruthy();
    });
    expect(screen.getByText("overlay analysis SUCCEEDED")).toBeTruthy();

    await userEvent.click(screen.getByText("overlay analysis SUCCEEDED"));
    await waitFor(() => {
      expect(screen.getByTestId("workflow-run-node-inspector")).toBeTruthy();
    });
    expect(screen.getAllByText(/3\.24\.1/).length).toBeGreaterThan(1);
    expect(
      screen.getAllByRole("link", { name: /run-analysis/ }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("link", { name: /run-research/ }).length,
    ).toBeGreaterThan(0);
  });

  it("updates overlay after a polling refresh without synthesizing success", async () => {
    let generation = 0;
    stubHumanSessionFetch("OPERATOR", "ws-1", (url) => {
      if (url.includes("/api/v1/workflows/wf-1/versions/wv-1")) {
        return Response.json({
          id: "wv-1",
          workflowId: "wf-1",
          workspaceId: "ws-1",
          version: 1,
          definition: {
            schemaVersion: "3",
            nodes: [{ key: "agent", type: "AGENT", agentVersionId: "av-1" }],
            edges: [],
          },
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      if (url.includes("/api/v1/workflow-runs/wr-1")) {
        generation += 1;
        return Response.json({
          id: "wr-1",
          workspaceId: "ws-1",
          workflowId: "wf-1",
          workflowVersionId: "wv-1",
          status: generation === 1 ? "RUNNING" : "FAILED",
          input: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:0" + String(generation) + ".000Z",
          nodeRuns: [
            {
              id: "wn-1",
              workspaceId: "ws-1",
              workflowRunId: "wr-1",
              workflowNodeKey: "agent",
              sequence: 1,
              status: generation === 1 ? "RUNNING" : "FAILED",
              input: {},
              childRunId: "run-child-1",
              error:
                generation === 1
                  ? undefined
                  : { code: "CHILD_RUN_FAILED", message: "agent failed" },
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:0" + String(generation) + ".000Z",
            },
          ],
          approvalRequests: [],
        });
      }
      return emptyArtifactListOrNotFound(url);
    });

    renderDetail();
    await waitFor(() => {
      expect(screen.getByText("overlay agent RUNNING")).toBeTruthy();
    });
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => {
      expect(screen.getByText("overlay agent FAILED")).toBeTruthy();
    });
    expect(screen.queryByText("overlay agent RUNNING")).toBeNull();
    expect(screen.getByText(/CHILD_RUN_FAILED/)).toBeTruthy();
  });

  it("keeps viewer authorization read-only for approvals", async () => {
    stubHumanSessionFetch("VIEWER", "ws-1", (url) => {
      if (url.includes("/api/v1/workflows/wf-1/versions/wv-1")) {
        return Response.json({
          id: "wv-1",
          workflowId: "wf-1",
          workspaceId: "ws-1",
          version: 1,
          definition,
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      if (url.includes("/api/v1/workflow-runs/wr-1")) {
        return Response.json({
          id: "wr-1",
          workspaceId: "ws-1",
          workflowId: "wf-1",
          workflowVersionId: "wv-1",
          status: "WAITING",
          input: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
          nodeRuns: [
            {
              id: "wn-2",
              workspaceId: "ws-1",
              workflowRunId: "wr-1",
              workflowNodeKey: "approval",
              sequence: 2,
              status: "WAITING",
              input: {},
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:01.000Z",
            },
          ],
          approvalRequests: [
            {
              id: "ar-1",
              workspaceId: "ws-1",
              workflowRunId: "wr-1",
              workflowNodeRunId: "wn-2",
              status: "PENDING",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:01.000Z",
            },
          ],
        });
      }
      return emptyArtifactListOrNotFound(url);
      return undefined;
    });

    renderDetail();
    await waitFor(() => {
      expect(screen.getByText("ar-1")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText(/cannot submit approval decisions/)).toBeTruthy();
  });
});

const reportDigest = `sha256:${"c".repeat(64)}`;

const canonicalDefinition = {
  schemaVersion: "3",
  nodes: [
    { key: "research", type: "AGENT", agentVersionId: "av-research" },
    { key: "approval", type: "APPROVAL", title: "Review" },
    { key: "report", type: "AGENT", agentVersionId: "av-report" },
    {
      key: "wait-event",
      type: "WAIT",
      wait: {
        kind: "EVENT",
        source: "billing",
        eventType: "invoice.paid",
        correlation: { kind: "LITERAL", value: "inv-1" },
      },
    },
  ],
  edges: [
    { from: "research", to: "approval" },
    { from: "approval", to: "report" },
    { from: "report", to: "wait-event" },
  ],
};

function workflowArtifact(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-report",
    name: "report.md",
    mediaType: "text/markdown",
    sizeBytes: 32,
    digest: reportDigest,
    createdAt: "2026-01-01T00:00:02.000Z",
    producer: { runId: "run-report", runAttemptId: "ra-report" },
    ...overrides,
  };
}

function renderWorkflowRunWithArtifacts(
  handler: (url: string, init?: RequestInit) => Response | undefined,
) {
  const fetchMock = stubHumanSessionFetch("OPERATOR", "ws-1", (url, init) =>
    handler(url, init),
  );
  renderDetail();
  return fetchMock;
}

describe("WorkflowRunDetailPage artifacts", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("associates the canonical Report markdown artifact with the Report AGENT node", async () => {
    renderWorkflowRunWithArtifacts((url) => {
      if (url.includes("/api/v1/workflows/wf-1/versions/wv-1")) {
        return Response.json({
          id: "wv-1",
          workflowId: "wf-1",
          workspaceId: "ws-1",
          version: 1,
          definition: canonicalDefinition,
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      if (url.includes("/api/v1/workflow-runs/wr-1")) {
        return Response.json({
          id: "wr-1",
          workspaceId: "ws-1",
          workflowId: "wf-1",
          workflowVersionId: "wv-1",
          status: "WAITING",
          input: {},
          output: {
            artifact: {
              type: "artifact",
              artifactId: "artifact-report",
            },
          },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:02.000Z",
          nodeRuns: [
            {
              id: "wn-research",
              workspaceId: "ws-1",
              workflowRunId: "wr-1",
              workflowNodeKey: "research",
              sequence: 1,
              status: "SUCCEEDED",
              input: {},
              childRunId: "run-research",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:01.000Z",
            },
            {
              id: "wn-approval",
              workspaceId: "ws-1",
              workflowRunId: "wr-1",
              workflowNodeKey: "approval",
              sequence: 2,
              status: "SUCCEEDED",
              input: {},
              createdAt: "2026-01-01T00:00:01.000Z",
              updatedAt: "2026-01-01T00:00:01.000Z",
            },
            {
              id: "wn-report",
              workspaceId: "ws-1",
              workflowRunId: "wr-1",
              workflowNodeKey: "report",
              sequence: 3,
              status: "SUCCEEDED",
              input: {},
              output: {
                artifact: {
                  type: "artifact",
                  artifactId: "artifact-report",
                },
              },
              childRunId: "run-report",
              createdAt: "2026-01-01T00:00:01.000Z",
              updatedAt: "2026-01-01T00:00:02.000Z",
            },
            {
              id: "wn-wait",
              workspaceId: "ws-1",
              workflowRunId: "wr-1",
              workflowNodeKey: "wait-event",
              sequence: 4,
              status: "WAITING",
              input: {},
              createdAt: "2026-01-01T00:00:02.000Z",
              updatedAt: "2026-01-01T00:00:02.000Z",
            },
          ],
          approvalRequests: [],
        });
      }
      if (url.includes("/api/v1/artifacts?") && url.includes("run-report")) {
        return Response.json({ items: [workflowArtifact()] });
      }
      if (url.includes("/api/v1/artifacts?") && url.includes("run-research")) {
        return Response.json({ items: [] });
      }
      if (url.endsWith("/api/v1/artifacts/artifact-report")) {
        return Response.json(workflowArtifact());
      }
      return emptyArtifactListOrNotFound(url);
    });

    await waitFor(() => {
      expect(screen.getByText("report.md")).toBeTruthy();
    });
    expect(screen.getByText("text/markdown")).toBeTruthy();
    expect(screen.getAllByText("report").length).toBeGreaterThan(0);
    expect(
      screen
        .getAllByRole("link", { name: "run-report" })
        .some((link) => link.getAttribute("href") === "/runs/run-report"),
    ).toBe(true);
    expect(screen.getByLabelText("Preview report.md")).toBeTruthy();
    expect(
      screen.getByLabelText("Download report.md").getAttribute("href"),
    ).toBe("/api/v1/artifacts/artifact-report/content");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Emit event" })).toBeNull();
  });

  it("lists artifacts from multiple AGENT nodes and ignores approval/wait producers", async () => {
    const fetchMock = renderWorkflowRunWithArtifacts((url) => {
      if (url.includes("/api/v1/workflows/wf-1/versions/wv-1")) {
        return Response.json({
          id: "wv-1",
          workflowId: "wf-1",
          workspaceId: "ws-1",
          version: 1,
          definition: canonicalDefinition,
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      if (url.includes("/api/v1/workflow-runs/wr-1")) {
        return Response.json({
          id: "wr-1",
          workspaceId: "ws-1",
          workflowId: "wf-1",
          workflowVersionId: "wv-1",
          status: "FAILED",
          input: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:03.000Z",
          nodeRuns: [
            {
              id: "wn-research",
              workspaceId: "ws-1",
              workflowRunId: "wr-1",
              workflowNodeKey: "research",
              sequence: 1,
              status: "SUCCEEDED",
              input: {},
              childRunId: "run-research",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:01.000Z",
            },
            {
              id: "wn-approval",
              workspaceId: "ws-1",
              workflowRunId: "wr-1",
              workflowNodeKey: "approval",
              sequence: 2,
              status: "SUCCEEDED",
              input: {},
              createdAt: "2026-01-01T00:00:01.000Z",
              updatedAt: "2026-01-01T00:00:01.000Z",
            },
            {
              id: "wn-report",
              workspaceId: "ws-1",
              workflowRunId: "wr-1",
              workflowNodeKey: "report",
              sequence: 3,
              status: "FAILED",
              input: {},
              childRunId: "run-report",
              createdAt: "2026-01-01T00:00:02.000Z",
              updatedAt: "2026-01-01T00:00:03.000Z",
            },
          ],
          approvalRequests: [],
        });
      }
      if (url.includes("/api/v1/artifacts?") && url.includes("run-research")) {
        return Response.json({
          items: [
            workflowArtifact({
              id: "artifact-notes",
              name: "notes.md",
              producer: { runId: "run-research", runAttemptId: "ra-r" },
              createdAt: "2026-01-01T00:00:01.000Z",
            }),
          ],
        });
      }
      if (url.includes("/api/v1/artifacts?") && url.includes("run-report")) {
        return Response.json({ items: [workflowArtifact()] });
      }
      return emptyArtifactListOrNotFound(url);
    });

    await waitFor(() => {
      expect(screen.getByText("notes.md")).toBeTruthy();
    });
    expect(screen.getByText("report.md")).toBeTruthy();
    expect(screen.getAllByText("research").length).toBeGreaterThan(0);
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/api/v1/artifacts?"),
      ),
    ).toHaveLength(2);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("should-not-exist"),
      ),
    ).toBe(false);
  });

  it("communicates a partial list failure and keeps other artifacts", async () => {
    renderWorkflowRunWithArtifacts((url) => {
      if (url.includes("/api/v1/workflows/wf-1/versions/wv-1")) {
        return Response.json({
          id: "wv-1",
          workflowId: "wf-1",
          workspaceId: "ws-1",
          version: 1,
          definition: canonicalDefinition,
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      if (url.includes("/api/v1/workflow-runs/wr-1")) {
        return Response.json({
          id: "wr-1",
          workspaceId: "ws-1",
          workflowId: "wf-1",
          workflowVersionId: "wv-1",
          status: "SUCCEEDED",
          input: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:02.000Z",
          nodeRuns: [
            {
              id: "wn-research",
              workspaceId: "ws-1",
              workflowRunId: "wr-1",
              workflowNodeKey: "research",
              sequence: 1,
              status: "SUCCEEDED",
              input: {},
              childRunId: "run-research",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:01.000Z",
            },
            {
              id: "wn-report",
              workspaceId: "ws-1",
              workflowRunId: "wr-1",
              workflowNodeKey: "report",
              sequence: 2,
              status: "SUCCEEDED",
              input: {},
              childRunId: "run-report",
              createdAt: "2026-01-01T00:00:01.000Z",
              updatedAt: "2026-01-01T00:00:02.000Z",
            },
          ],
          approvalRequests: [],
        });
      }
      if (url.includes("/api/v1/artifacts?") && url.includes("run-research")) {
        return Response.json({ error: "upstream failed" }, { status: 503 });
      }
      if (url.includes("/api/v1/artifacts?") && url.includes("run-report")) {
        return Response.json({ items: [workflowArtifact()] });
      }
      return emptyArtifactListOrNotFound(url);
    });

    await waitFor(() => {
      expect(screen.getByText("report.md")).toBeTruthy();
    });
    expect(
      screen.getByText("Some artifact lists could not be loaded"),
    ).toBeTruthy();
    expect(
      screen.getByText(/Could not load artifacts for research/),
    ).toBeTruthy();
  });

  it("surfaces a pagination bound instead of silently omitting later artifacts", async () => {
    renderWorkflowRunWithArtifacts((url) => {
      if (url.includes("/api/v1/workflows/wf-1/versions/wv-1")) {
        return Response.json({
          id: "wv-1",
          workflowId: "wf-1",
          workspaceId: "ws-1",
          version: 1,
          definition: {
            schemaVersion: "3",
            nodes: [{ key: "report", type: "AGENT", agentVersionId: "av-1" }],
            edges: [],
          },
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      if (url.includes("/api/v1/workflow-runs/wr-1")) {
        return Response.json({
          id: "wr-1",
          workspaceId: "ws-1",
          workflowId: "wf-1",
          workflowVersionId: "wv-1",
          status: "SUCCEEDED",
          input: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
          nodeRuns: [
            {
              id: "wn-report",
              workspaceId: "ws-1",
              workflowRunId: "wr-1",
              workflowNodeKey: "report",
              sequence: 1,
              status: "SUCCEEDED",
              input: {},
              childRunId: "run-report",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:01.000Z",
            },
          ],
          approvalRequests: [],
        });
      }
      if (url.includes("/api/v1/artifacts?")) {
        return Response.json({
          items: [workflowArtifact()],
          nextCursor: "more",
        });
      }
      return emptyArtifactListOrNotFound(url);
    });

    await waitFor(() => {
      expect(screen.getByText("report.md")).toBeTruthy();
    });
    expect(screen.getByText(/bounded page of artifacts/i)).toBeTruthy();
  });

  it("keeps an open preview across workflow refresh polling", async () => {
    let runGeneration = 0;
    renderWorkflowRunWithArtifacts((url) => {
      if (url.includes("/api/v1/workflows/wf-1/versions/wv-1")) {
        return Response.json({
          id: "wv-1",
          workflowId: "wf-1",
          workspaceId: "ws-1",
          version: 1,
          definition: {
            schemaVersion: "3",
            nodes: [{ key: "report", type: "AGENT", agentVersionId: "av-1" }],
            edges: [],
          },
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      if (url.includes("/api/v1/workflow-runs/wr-1")) {
        runGeneration += 1;
        return Response.json({
          id: "wr-1",
          workspaceId: "ws-1",
          workflowId: "wf-1",
          workflowVersionId: "wv-1",
          status: "WAITING",
          input: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: `2026-01-01T00:00:0${runGeneration}.000Z`,
          nodeRuns: [
            {
              id: "wn-report",
              workspaceId: "ws-1",
              workflowRunId: "wr-1",
              workflowNodeKey: "report",
              sequence: 1,
              status: "SUCCEEDED",
              input: {},
              childRunId: "run-report",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:01.000Z",
            },
          ],
          approvalRequests: [],
        });
      }
      if (url.includes("/api/v1/artifacts?") && url.includes("run-report")) {
        return Response.json({ items: [workflowArtifact()] });
      }
      if (url.endsWith("/api/v1/artifacts/artifact-report/content")) {
        return new Response("preview body", { status: 200 });
      }
      return emptyArtifactListOrNotFound(url);
    });

    await waitFor(() => {
      expect(screen.getByText("report.md")).toBeTruthy();
    });
    await userEvent.click(screen.getByLabelText("Preview report.md"));
    await waitFor(() => {
      expect(screen.getByText("preview body")).toBeTruthy();
    });
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => {
      expect(runGeneration).toBeGreaterThan(1);
    });
    expect(screen.getByText("preview body")).toBeTruthy();
    expect(
      screen
        .getAllByRole("link", { name: "run-report" })
        .some((link) => link.getAttribute("href") === "/runs/run-report"),
    ).toBe(true);
  });

  it("does not treat a producer-mismatched list item as a workflow artifact", async () => {
    renderWorkflowRunWithArtifacts((url) => {
      if (url.includes("/api/v1/workflows/wf-1/versions/wv-1")) {
        return Response.json({
          id: "wv-1",
          workflowId: "wf-1",
          workspaceId: "ws-1",
          version: 1,
          definition: {
            schemaVersion: "3",
            nodes: [{ key: "report", type: "AGENT", agentVersionId: "av-1" }],
            edges: [],
          },
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      if (url.includes("/api/v1/workflow-runs/wr-1")) {
        return Response.json({
          id: "wr-1",
          workspaceId: "ws-1",
          workflowId: "wf-1",
          workflowVersionId: "wv-1",
          status: "SUCCEEDED",
          input: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
          nodeRuns: [
            {
              id: "wn-report",
              workspaceId: "ws-1",
              workflowRunId: "wr-1",
              workflowNodeKey: "report",
              sequence: 1,
              status: "SUCCEEDED",
              input: {},
              childRunId: "run-report",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:01.000Z",
            },
          ],
          approvalRequests: [],
        });
      }
      if (url.includes("/api/v1/artifacts?")) {
        return Response.json({
          items: [
            workflowArtifact({
              id: "artifact-foreign",
              name: "foreign.md",
              producer: { runId: "run-other", runAttemptId: "ra-x" },
            }),
          ],
        });
      }
      return emptyArtifactListOrNotFound(url);
    });

    await waitFor(() => {
      expect(screen.getByText("No artifacts produced.")).toBeTruthy();
    });
    expect(screen.queryByText("foreign.md")).toBeNull();
  });
});
