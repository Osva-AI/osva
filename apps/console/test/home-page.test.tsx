import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "../src/client/components/app-shell/app-shell";
import { AuthProvider } from "../src/client/context/auth-context";
import { HOME_PRESENTATION_PREFERENCE_STORAGE_KEY } from "../src/client/lib/home-presentation-preference";
import { OverviewPage } from "../src/client/routes/overview-page";
import { json, stubHumanSessionFetch } from "./human-auth-fetch-stub";
import {
  getSelectedWorkspaceId,
  setSelectedWorkspaceId,
} from "../src/client/lib/workspace-selection";

function stubEmptyWorkspace(role: string) {
  stubHumanSessionFetch(role, "ws-1", (url) => {
    if (url.includes("/api/v1/agents")) {
      return json({ agents: [] });
    }
    if (url.includes("/api/v1/workflows")) {
      return json({ workflows: [] });
    }
    if (url.includes("/api/v1/runs")) {
      return json({ runs: [] });
    }
    if (url.includes("/api/v1/workflow-runs")) {
      return json({ workflowRuns: [] });
    }
    if (url.includes("/api/v1/model-profiles")) {
      return json({ modelProfiles: [] });
    }
    if (url.includes("/api/v1/model-provider-connections")) {
      return json({ connections: [] });
    }
    if (url.match(/\/api\/v1\/agents\/[^/]+\/versions$/)) {
      return json({ versions: [] });
    }
    return undefined;
  });
}

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/overview"]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/overview" element={<OverviewPage />} />
            </Route>
            <Route path="/" element={<Navigate to="/overview" replace />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("Home (OverviewPage)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.removeItem(HOME_PRESENTATION_PREFERENCE_STORAGE_KEY);
  });

  it("shows new workspace hero when registry is empty", async () => {
    stubEmptyWorkspace("DEVELOPER");
    renderHome();

    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          name: "What would you like AI to do for you?",
        }),
      ).toBeTruthy();
    });
  });

  it("persists advanced presentation preference", async () => {
    stubEmptyWorkspace("DEVELOPER");
    renderHome();
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Advanced" })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Advanced" }));
    expect(localStorage.getItem(HOME_PRESENTATION_PREFERENCE_STORAGE_KEY)).toBe(
      "advanced",
    );

    await waitFor(() => {
      expect(screen.getByText(/Resource navigation/i)).toBeTruthy();
    });
  });

  it("hides write actions for viewers on new home", async () => {
    stubEmptyWorkspace("VIEWER");
    renderHome();

    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          name: "What would you like AI to do for you?",
        }),
      ).toBeTruthy();
    });
    expect(screen.queryByRole("link", { name: "Create agent" })).toBeNull();
    expect(
      screen.getAllByRole("link", { name: /View agents/i }).length,
    ).toBeGreaterThan(0);
  });

  it("shows partial data warning on active home when a secondary query fails", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url) => {
      if (url.includes("/api/v1/agents") && !url.includes("versions")) {
        return json({
          agents: [
            {
              id: "a1",
              workspaceId: "ws-1",
              key: "demo",
              name: "Demo Agent",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes("/api/v1/workflows")) {
        return json({ error: "denied" }, 500);
      }
      if (url.includes("/api/v1/runs")) {
        return json({ runs: [] });
      }
      if (url.includes("/api/v1/workflow-runs")) {
        return json({ workflowRuns: [] });
      }
      if (url.includes("/api/v1/model-profiles")) {
        return json({ modelProfiles: [] });
      }
      if (url.includes("/api/v1/model-provider-connections")) {
        return json({ connections: [] });
      }
      return undefined;
    });

    renderHome();

    await waitFor(() => {
      expect(screen.getByText(/Welcome back/i)).toBeTruthy();
    });
    expect(screen.getByText(/Partial data/i)).toBeTruthy();
    expect(screen.getByText(/Workflows:/i)).toBeTruthy();
  });

  it("shows active home when agents exist", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url) => {
      if (url.includes("/api/v1/agents") && !url.includes("versions")) {
        return json({
          agents: [
            {
              id: "a1",
              workspaceId: "ws-1",
              key: "demo",
              name: "Demo Agent",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes("/api/v1/workflows")) {
        return json({ workflows: [] });
      }
      if (url.includes("/api/v1/runs")) {
        return json({ runs: [] });
      }
      if (url.includes("/api/v1/workflow-runs")) {
        return json({ workflowRuns: [] });
      }
      if (url.includes("/api/v1/model-profiles")) {
        return json({ modelProfiles: [] });
      }
      if (url.includes("/api/v1/model-provider-connections")) {
        return json({ connections: [] });
      }
      if (url.match(/\/api\/v1\/agents\/[^/]+\/versions$/)) {
        return json({ versions: [] });
      }
      return undefined;
    });

    renderHome();

    await waitFor(() => {
      expect(screen.getByText(/Welcome back/i)).toBeTruthy();
    });
    expect(screen.getByText("Demo Agent")).toBeTruthy();
  });

  it("shows degraded state instead of empty hero when runs query fails", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url) => {
      if (url.includes("/api/v1/agents")) {
        return json({ agents: [] });
      }
      if (url.includes("/api/v1/workflows")) {
        return json({ workflows: [] });
      }
      if (url.includes("/api/v1/runs")) {
        return json({ error: "fail" }, 500);
      }
      if (url.includes("/api/v1/workflow-runs")) {
        return json({ workflowRuns: [] });
      }
      if (url.includes("/api/v1/model-profiles")) {
        return json({ modelProfiles: [] });
      }
      if (url.includes("/api/v1/model-provider-connections")) {
        return json({ connections: [] });
      }
      return undefined;
    });

    renderHome();

    await waitFor(() => {
      expect(screen.getByText(/Home data is incomplete/i)).toBeTruthy();
    });
    expect(
      screen.queryByRole("heading", {
        name: "What would you like AI to do for you?",
      }),
    ).toBeNull();
  });

  it("labels registry counts truthfully in advanced mode", async () => {
    localStorage.setItem(HOME_PRESENTATION_PREFERENCE_STORAGE_KEY, "advanced");
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url) => {
      if (url.includes("/api/v1/agents") && !url.includes("versions")) {
        return json({ agents: [{ id: "a1" }, { id: "a2" }] });
      }
      if (url.includes("/api/v1/workflows")) {
        return json({ workflows: [{ id: "w1" }] });
      }
      if (url.includes("/api/v1/runs")) {
        return json({
          runs: [
            {
              id: "run-1",
              agentId: "a1",
              status: "SUCCEEDED",
              effectiveBindings: {
                agentVersionId: "av-1",
                modelProfileVersionBindings: {},
                toolVersionBindings: {},
              },
              input: {},
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:01.000Z",
            },
          ],
          nextCursor: "cursor-more",
        });
      }
      if (url.includes("/api/v1/workflow-runs")) {
        return json({ workflowRuns: [] });
      }
      if (url.includes("/api/v1/model-profiles")) {
        return json({ modelProfiles: [] });
      }
      if (url.includes("/api/v1/model-provider-connections")) {
        return json({ connections: [] });
      }
      return undefined;
    });

    renderHome();

    await waitFor(() => {
      expect(screen.getByText("2")).toBeTruthy();
    });
    expect(screen.getAllByText(/full registry list/i).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText(/more on Runs page/i)).toBeTruthy();
  });

  it("does not show stale agent names after workspace switch", async () => {
    setSelectedWorkspaceId("ws-1");
    const fetchMock = stubHumanSessionFetch("DEVELOPER", "ws-1", (url) => {
      if (url.includes("/api/v1/auth/workspaces")) {
        return json({
          workspaces: [
            { workspaceId: "ws-1", name: "Workspace One", role: "DEVELOPER" },
            { workspaceId: "ws-2", name: "Workspace Two", role: "DEVELOPER" },
          ],
        });
      }
      return undefined;
    });

    fetchMock.mockImplementation(async (input: RequestInfo) => {
      const url = String(input);
      const workspaceId = getSelectedWorkspaceId();
      if (url.includes("/api/v1/auth/workspaces")) {
        return json({
          workspaces: [
            { workspaceId: "ws-1", name: "Workspace One", role: "DEVELOPER" },
            { workspaceId: "ws-2", name: "Workspace Two", role: "DEVELOPER" },
          ],
        });
      }
      if (url.includes("/api/v1/agents") && !url.includes("versions")) {
        if (workspaceId === "ws-2") {
          return json({ agents: [] });
        }
        return json({
          agents: [
            {
              id: "ws1-agent",
              workspaceId: "ws-1",
              key: "a",
              name: "Workspace One Agent",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes("/api/v1/workflows")) {
        return json({ workflows: [] });
      }
      if (url.includes("/api/v1/runs")) {
        return json({ runs: [] });
      }
      if (url.includes("/api/v1/workflow-runs")) {
        return json({ workflowRuns: [] });
      }
      if (url.includes("/api/v1/model-profiles")) {
        return json({ modelProfiles: [] });
      }
      if (url.includes("/api/v1/model-provider-connections")) {
        return json({ connections: [] });
      }
      if (url.includes("/api/v1/auth/session")) {
        return json({
          userId: "user-1",
          sessionId: "session-1",
          expiresAt: "2099-01-01T00:00:00.000Z",
        });
      }
      if (url.includes("/api/v1/auth/me")) {
        return json({
          userId: "user-1",
          email: "operator@example.com",
          displayName: "Operator",
          status: "ACTIVE",
        });
      }
      return json({ error: "not found" }, 404);
    });

    renderHome();

    await waitFor(() => {
      expect(screen.getByText("Workspace One Agent")).toBeTruthy();
    });

    setSelectedWorkspaceId("ws-2");
    window.dispatchEvent(new Event("osva-workspace-selected"));

    await waitFor(
      () => {
        expect(screen.queryByText("Workspace One Agent")).toBeNull();
      },
      { timeout: 5000 },
    );

    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          name: "What would you like AI to do for you?",
        }),
      ).toBeTruthy();
    });
  });
});
