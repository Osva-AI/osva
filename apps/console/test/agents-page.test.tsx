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

import { AgentCreatePage } from "../src/client/routes/agent-create-page";
import { AgentDetailPage } from "../src/client/routes/agent-detail-page";
import { AgentVersionCreatePage } from "../src/client/routes/agent-version-create-page";
import { AgentVersionPage } from "../src/client/routes/agent-version-page";
import { AgentsPage } from "../src/client/routes/agents-page";
import { OnboardingPage } from "../src/client/routes/onboarding-page";
import { WorkflowCreatePage } from "../src/client/routes/workflow-create-page";

vi.mock("../src/client/components/workflow/workflow-builder-canvas", () => ({
  WorkflowBuilderCanvas: () => (
    <div data-testid="workflow-builder-canvas-mock" />
  ),
}));

function renderAgents(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/new" element={<AgentCreatePage />} />
          <Route path="/agents/:agentId" element={<AgentDetailPage />} />
          <Route
            path="/agents/:agentId/versions/new"
            element={<AgentVersionCreatePage />}
          />
          <Route
            path="/agents/:agentId/versions/:agentVersionId"
            element={<AgentVersionPage />}
          />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/workflows/new" element={<WorkflowCreatePage />} />
          <Route path="/runs/:runId" element={<div>Opened Run</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

const agent = {
  id: "agent-echo",
  workspaceId: "ws-1",
  key: "echo-agent",
  name: "Echo Agent",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const version = {
  id: "av-echo",
  agentId: "agent-echo",
  version: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  manifest: {
    schemaVersion: "1",
    runtime: { type: "TRUSTED_TYPESCRIPT", entrypoint: "echo-agent.ts" },
    input: { schema: { type: "object" } },
    capabilities: { model: false, tools: [] },
  },
};

function stubConsole(
  role: string,
  extra?: (url: string, init?: RequestInit) => Response | undefined,
) {
  const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const extraResponse = extra?.(url, init);
    if (extraResponse !== undefined) {
      return extraResponse;
    }
    if (url.includes("/api/v1/auth/context")) {
      return json({
        subjectId: "sub-1",
        workspaceId: "ws-1",
        role,
      });
    }
    if (url === "/api/v1/agents" && method === "GET") {
      return json({ agents: [agent] });
    }
    if (url === "/api/v1/agents/agent-echo/versions" && method === "GET") {
      return json({ versions: [version] });
    }
    if (url === "/api/v1/agents/agent-echo/versions/av-echo") {
      return json(version);
    }
    if (url === "/api/v1/agents/agent-echo" && method === "GET") {
      return json(agent);
    }
    return json({ error: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Agents UI", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("renders the agent registry", async () => {
    stubConsole("ADMIN");
    renderAgents("/agents");
    await waitFor(() => {
      expect(screen.getByText("Echo Agent")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: "agent-echo" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Register Agent" })).toBeTruthy();
  });

  it("hides register for VIEWER", async () => {
    stubConsole("VIEWER");
    renderAgents("/agents");
    await waitFor(() => {
      expect(screen.getByText("Echo Agent")).toBeTruthy();
    });
    expect(screen.queryByRole("link", { name: "Register Agent" })).toBeNull();
  });

  it("registers an agent and navigates to the persisted id", async () => {
    const user = userEvent.setup();
    const fetchMock = stubConsole("EDITOR", (url, init) => {
      if (url === "/api/v1/agents" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          key: string;
          name: string;
        };
        expect(body).toEqual({
          key: "hello-agent",
          name: "Hello Agent",
        });
        return json({ ...agent, id: "agent-created" }, 201);
      }
      if (url === "/api/v1/agents/agent-created") {
        return json({ ...agent, id: "agent-created" });
      }
      if (url === "/api/v1/agents/agent-created/versions") {
        return json({ versions: [] });
      }
      return undefined;
    });
    renderAgents("/agents/new");
    await waitFor(() => {
      expect(screen.getByLabelText("Key")).toBeTruthy();
    });
    await user.click(
      screen.getByRole("button", { name: "Use Hello Agent example" }),
    );
    await user.click(screen.getByRole("button", { name: "Register Agent" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Agent" })).toBeTruthy();
    });
    expect(screen.getByText("agent-created")).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url) === "/api/v1/agents" && init?.method === "POST",
      ),
    ).toBe(true);
  });

  it("lists immutable versions and does not offer Run Agent to VIEWER", async () => {
    stubConsole("VIEWER");
    renderAgents("/agents/agent-echo");
    await waitFor(() => {
      expect(screen.getByText("av-echo")).toBeTruthy();
    });
    expect(screen.getByText("TRUSTED_TYPESCRIPT")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Run Agent" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Create version" })).toBeNull();
  });

  it("lets an operator open Run Agent for the selected version", async () => {
    stubConsole("OPERATOR");
    renderAgents("/agents/agent-echo");
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Run Agent" })).toBeTruthy();
    });
  });

  it("rejects invalid version JSON before posting", async () => {
    stubConsole("ADMIN");
    renderAgents("/agents/agent-echo/versions/new");
    await waitFor(() => {
      expect(screen.getByLabelText("Manifest (JSON)")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Manifest (JSON)"), {
      target: { value: "{nope" },
    });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Create AgentVersion",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("blocks submit while TRUSTED_TYPESCRIPT integrity is a placeholder", async () => {
    stubConsole("ADMIN");
    renderAgents("/agents/agent-echo/versions/new");
    await waitFor(() => {
      expect(screen.getByLabelText("runtime.integrity")).toBeTruthy();
    });
    expect(screen.getByLabelText("Runtime type")).toBeTruthy();
    expect(screen.getByText(/must be sha256:<64 hex chars>/i)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Create AgentVersion",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("shows selected version identity and honest readiness", async () => {
    stubConsole("ADMIN");
    renderAgents("/agents/agent-echo/versions/av-echo");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Run Agent" })).toBeTruthy();
    });
    expect(screen.getByText("TRUSTED_TYPESCRIPT")).toBeTruthy();
    expect(screen.getByText("Input and output contracts")).toBeTruthy();
    expect(screen.getAllByText("Not verified").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/A responding Console API is not evidence/i),
    ).toBeTruthy();
    expect(screen.getAllByText("Verified ready").length).toBeGreaterThan(0);
  });

  it("walks onboarding links without storing credentials", async () => {
    stubConsole("ADMIN");
    renderAgents("/onboarding?agentId=agent-echo&agentVersionId=av-echo");
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Run Agent" })).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: "Open registry" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open builder" }).getAttribute("href"),
    ).toBe("/workflows/new?agentId=agent-echo&agentVersionId=av-echo");
    expect(document.body.textContent ?? "").not.toMatch(/osva_ak_|Bearer /);
  });

  it("blocks write and execute onboarding steps for VIEWER", async () => {
    stubConsole("VIEWER");
    renderAgents("/onboarding");
    await waitFor(() => {
      expect(screen.getByText("First-agent onboarding")).toBeTruthy();
    });
    expect(
      screen.getAllByText(/requires EDITOR or ADMIN/).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/requires OPERATOR, EDITOR, or ADMIN/).length,
    ).toBeGreaterThan(0);
  });

  it("shows Workflow Builder handoff guidance for a selected version", async () => {
    stubConsole("ADMIN");
    renderAgents("/workflows/new?agentId=agent-echo&agentVersionId=av-echo");
    await waitFor(() => {
      expect(screen.getByText("AgentVersion handoff")).toBeTruthy();
    });
    expect(screen.getAllByText("av-echo").length).toBeGreaterThan(0);
    expect(screen.getByText(/does not auto-select it/i)).toBeTruthy();
  });
});
