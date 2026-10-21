import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentPlaygroundPanel } from "../src/client/components/agent/agent-playground-panel";

const echoVersion = {
  id: "av-echo",
  agentId: "agent-echo",
  version: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  manifest: {
    runtime: { type: "TRUSTED_TYPESCRIPT" },
    input: { schema: { type: "object" } },
    capabilities: { model: false, tools: [] },
  },
};

vi.mock("../src/client/hooks/use-agents", () => ({
  useAgentsListQuery: () => ({
    isLoading: false,
    data: {
      agents: [{ id: "agent-echo", key: "echo", name: "Echo" }],
    },
  }),
  useAgentQuery: () => ({ data: { key: "echo", name: "Echo" } }),
  useAgentVersionsQuery: () => ({
    isLoading: false,
    data: { versions: [echoVersion] },
  }),
  useAgentVersionQuery: () => ({ isLoading: false, data: echoVersion }),
}));

function renderPanel(canExecute = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AgentPlaygroundPanel mode="standalone" canExecute={canExecute} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AgentPlaygroundPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("blocks viewers from starting tests", () => {
    renderPanel(false);
    expect(screen.getByText(/cannot EXECUTE test runs/i)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Run test" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("posts restrictPersistentMemory when the checkbox is enabled", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
        void init;
        const url = typeof input === "string" ? input : input.url;
        if (url.endsWith("/api/v1/runs")) {
          return new Response(
            JSON.stringify({
              run: { id: "run-1", status: "QUEUED" },
              runAttempt: { id: "ra-1", status: "PENDING" },
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/api/v1/runs/run-1")) {
          return new Response(
            JSON.stringify({
              id: "run-1",
              status: "SUCCEEDED",
              restrictPersistentMemory: true,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/attempts/ra-1")) {
          return new Response(
            JSON.stringify({
              id: "ra-1",
              status: "SUCCEEDED",
              output: { echoed: true },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderPanel(true);
    fireEvent.change(screen.getByLabelText("Agent"), {
      target: { value: "agent-echo" },
    });
    fireEvent.change(screen.getByLabelText("AgentVersion"), {
      target: { value: "av-echo" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Run test" }));

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find((call) => {
        const url = typeof call[0] === "string" ? call[0] : call[0].url;
        return url.endsWith("/api/v1/runs");
      });
      expect(createCall).toBeTruthy();
      const init = createCall?.[1] as RequestInit | undefined;
      expect(init).toBeDefined();
      expect(JSON.parse(String(init!.body))).toEqual({
        agentId: "agent-echo",
        agentVersionId: "av-echo",
        input: {},
        restrictPersistentMemory: true,
      });
    });
  });
});
