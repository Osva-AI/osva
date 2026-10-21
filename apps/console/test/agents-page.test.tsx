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

import { AuthProvider } from "../src/client/context/auth-context";
import { AgentCreateDeveloperPage } from "../src/client/routes/agent-create-developer-page";
import { AgentCreatePage } from "../src/client/routes/agent-create-page";
import { stubHumanSessionFetch, json } from "./human-auth-fetch-stub";
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
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/agents/new" element={<AgentCreatePage />} />
            <Route
              path="/agents/new/developer"
              element={<AgentCreateDeveloperPage />}
            />
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
      </AuthProvider>
    </QueryClientProvider>,
  );
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
  const fetchMock = stubHumanSessionFetch(role, "ws-1", (url, init) => {
    const method = init?.method ?? "GET";
    const extraResponse = extra?.(url, init);
    if (extraResponse !== undefined) {
      return extraResponse;
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
    return undefined;
  });
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
      expect(screen.getByRole("link", { name: "Create Agent" })).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: "agent-echo" })).toBeTruthy();
  });

  it("hides register for VIEWER", async () => {
    stubConsole("VIEWER");
    renderAgents("/agents");
    await waitFor(() => {
      expect(screen.getByText("Echo Agent")).toBeTruthy();
    });
    expect(screen.queryByRole("link", { name: "Create Agent" })).toBeNull();
  });

  it("registers an agent and navigates to the persisted id", async () => {
    const user = userEvent.setup();
    const fetchMock = stubConsole("DEVELOPER", (url, init) => {
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
        return json({
          ...agent,
          id: "agent-created",
          key: "hello-agent",
          name: "Hello Agent",
        });
      }
      if (url === "/api/v1/agents/agent-created/versions") {
        return json({ versions: [] });
      }
      return undefined;
    });
    renderAgents("/agents/new/developer");
    await waitFor(() => {
      expect(screen.getByLabelText("Key")).toBeTruthy();
    });
    await user.click(
      screen.getByRole("button", { name: "Use Hello Agent example" }),
    );
    await user.click(screen.getByRole("button", { name: "Register Agent" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Manifest (JSON)")).toBeTruthy();
    });
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
    renderAgents("/agents/agent-echo/versions/new?developer=1");
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
    renderAgents("/agents/agent-echo/versions/new?developer=1");
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Load Hello Agent manifest" }),
      ).toBeTruthy();
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Load Hello Agent manifest" }),
    );
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
    stubConsole("ADMIN", (url) => {
      if (url.includes("/api/v1/model-provider-connections")) {
        return json({ connections: [] });
      }
      if (
        url.includes("/api/v1/model-profiles") &&
        !url.includes("/versions")
      ) {
        return json({ modelProfiles: [] });
      }
      if (url.includes("/api/v1/workflows")) {
        return json({ workflows: [] });
      }
      if (url.includes("/api/v1/runs")) {
        return json({ runs: [] });
      }
      return undefined;
    });
    renderAgents("/onboarding?agentId=agent-echo&agentVersionId=av-echo");
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Getting started", level: 1 }),
      ).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Run Agent" })).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: "Open Models" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create Agent" })).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Publish version" })
        .getAttribute("href"),
    ).toBe("/agents/agent-echo/versions/av-echo");
    expect(
      screen
        .getByRole("link", { name: "Open Workflow Builder" })
        .getAttribute("href"),
    ).toBe("/workflows/new?agentId=agent-echo&agentVersionId=av-echo");
    expect(document.body.textContent ?? "").not.toMatch(/osva_ak_|Bearer /);
  });

  it("blocks write and execute onboarding steps for VIEWER", async () => {
    stubConsole("VIEWER");
    renderAgents("/onboarding");
    await waitFor(() => {
      expect(screen.getByText("Getting started")).toBeTruthy();
    });
    expect(
      screen.getAllByText(/requires DEVELOPER, ADMIN, or OWNER/).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/requires OPERATOR, DEVELOPER, ADMIN, or OWNER/)
        .length,
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
