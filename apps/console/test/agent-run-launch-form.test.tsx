import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentRunLaunchForm } from "../src/client/components/agent/agent-run-launch-form";
import type { AgentVersionResource } from "../src/client/hooks/use-agents";

const selectedVersion: AgentVersionResource = {
  id: "av-echo",
  agentId: "agent-echo",
  version: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  manifest: {
    runtime: { type: "TRUSTED_TYPESCRIPT" },
    input: {
      schema: {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: { type: "string", const: "hello" },
        },
      },
    },
    capabilities: { model: false, tools: [] },
  },
};

function renderLaunch(canExecute = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/agents/agent-echo/versions/av-echo"]}>
        <Routes>
          <Route
            path="/agents/:agentId/versions/:agentVersionId"
            element={
              <AgentRunLaunchForm
                agentId="agent-echo"
                agentKey="echo-agent"
                agentName="Echo Agent"
                selectedVersion={selectedVersion}
                canExecute={canExecute}
              />
            }
          />
          <Route path="/runs/:runId" element={<div>Opened Run</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AgentRunLaunchForm", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("rejects malformed JSON before calling the BFF", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderLaunch();

    const textarea = screen.getByLabelText("Run input (JSON)");
    fireEvent.change(textarea, { target: { value: "{not-json" } });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Run Agent" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("binds the selected AgentVersion id and navigates to the created Run", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe("/api/v1/runs");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        agentId: "agent-echo",
        agentVersionId: "av-echo",
        input: { prompt: "hello" },
      });
      return Response.json({
        run: {
          id: "run-created",
          agentId: "agent-echo",
          status: "QUEUED",
          effectiveBindings: {
            agentVersionId: "av-echo",
            modelProfileVersionBindings: {},
            toolVersionBindings: {},
          },
          input: { prompt: "hello" },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        runAttempt: {
          id: "ra-created",
          runId: "run-created",
          sequence: 1,
          status: "PENDING",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderLaunch();
    await waitFor(() => {
      expect(screen.getByLabelText("Run input (JSON)")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Run input (JSON)"), {
      target: { value: '{"prompt":"hello"}' },
    });
    await user.click(screen.getByRole("button", { name: "Run Agent" }));
    await user.click(screen.getByRole("button", { name: "Confirm start run" }));

    await waitFor(() => {
      expect(screen.getByText("Opened Run")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("prevents a second submit while a create is in flight", async () => {
    const user = userEvent.setup();
    let resolveCreate: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderLaunch();
    fireEvent.change(screen.getByLabelText("Run input (JSON)"), {
      target: { value: '{"prompt":"hello"}' },
    });
    await user.click(screen.getByRole("button", { name: "Run Agent" }));
    await user.click(screen.getByRole("button", { name: "Confirm start run" }));
    const pendingButton = screen.getByRole("button", { name: "Starting run…" });
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveCreate?.(
      Response.json({
        run: {
          id: "run-created",
          agentId: "agent-echo",
          status: "QUEUED",
          effectiveBindings: {
            agentVersionId: "av-echo",
            modelProfileVersionBindings: {},
            toolVersionBindings: {},
          },
          input: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        runAttempt: {
          id: "ra-1",
          runId: "run-created",
          sequence: 1,
          status: "PENDING",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    );
    await waitFor(() => {
      expect(screen.getByText("Opened Run")).toBeTruthy();
    });
  });

  it.each([400, 403, 404, 409] as const)(
    "surfaces %i without inventing a run",
    async (status) => {
      const user = userEvent.setup();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json(
            { error: "rejected", requestId: `req-${String(status)}` },
            {
              status,
              headers: { "x-osva-request-id": `req-${String(status)}` },
            },
          ),
        ),
      );

      renderLaunch();
      fireEvent.change(screen.getByLabelText("Run input (JSON)"), {
        target: { value: '{"prompt":"hello"}' },
      });
      await user.click(screen.getByRole("button", { name: "Run Agent" }));
      await user.click(
        screen.getByRole("button", { name: "Confirm start run" }),
      );

      await waitFor(() => {
        expect(screen.getByText(`req-${String(status)}`)).toBeTruthy();
      });
      expect(screen.getByText("rejected")).toBeTruthy();
      expect(screen.queryByText("Opened Run")).toBeNull();
      expect(
        (screen.getByLabelText("Run input (JSON)") as HTMLTextAreaElement)
          .value,
      ).toBe('{"prompt":"hello"}');
    },
  );

  it("does not let viewers start a run", () => {
    renderLaunch(false);
    expect(
      (screen.getByRole("button", { name: "Run Agent" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText(/OPERATOR, EDITOR, or ADMIN/)).toBeTruthy();
  });

  it("shows the selected version contract and does not treat syntax as execution success", async () => {
    vi.stubGlobal("fetch", vi.fn());
    renderLaunch();
    await waitFor(() => {
      expect(screen.getByText("Input schema")).toBeTruthy();
    });
    expect(screen.getByText("av-echo")).toBeTruthy();
    expect(
      screen.getByText(/does not mean this AgentVersion will accept/i),
    ).toBeTruthy();
  });
});
