import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "../src/client/components/app-shell/app-shell";
import { AuthProvider } from "../src/client/context/auth-context";
import { OverviewPage } from "../src/client/routes/overview-page";
import { json, stubHumanSessionFetch } from "./human-auth-fetch-stub";
import {
  getSelectedWorkspaceId,
  setSelectedWorkspaceId,
} from "../src/client/lib/workspace-selection";

function renderOverview(role: string) {
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
              <Route
                path="/agents/new"
                element={<div>Create Agent page</div>}
              />
            </Route>
            <Route path="/" element={<Navigate to="/overview" replace />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("OverviewPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("redirects / to overview", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url) => {
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
      return undefined;
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={["/"]}>
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

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Overview", level: 1 }),
      ).toBeTruthy();
    });
  });

  it("labels registry counts and recent run lists truthfully", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url) => {
      if (url.includes("/api/v1/agents")) {
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

    renderOverview("DEVELOPER");

    await waitFor(() => {
      expect(screen.getByText("2")).toBeTruthy();
    });
    expect(screen.getAllByText(/full registry list/i).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText(/more on Runs page/i)).toBeTruthy();
  });

  it("hides write actions for viewers but keeps overview readable", async () => {
    stubHumanSessionFetch("VIEWER", "ws-1", (url) => {
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
      return undefined;
    });

    renderOverview("VIEWER");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Overview", level: 1 }),
      ).toBeTruthy();
    });
    expect(screen.queryByRole("link", { name: "Create Agent" })).toBeNull();
    expect(screen.getByRole("link", { name: "View Runs" })).toBeTruthy();
  });

  it("does not show stale counts after workspace switch", async () => {
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
      if (url.includes("/api/v1/agents")) {
        return json({
          agents: [
            {
              id: "ws1-agent",
              workspaceId: "ws-1",
              key: "a",
              name: "A",
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
      return undefined;
    });

    fetchMock.mockImplementation(
      async (input: RequestInfo, init?: RequestInit) => {
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
        if (url.includes("/api/v1/agents")) {
          if (workspaceId === "ws-2") {
            return json({ agents: [] });
          }
          return json({
            agents: [
              {
                id: "ws1-agent",
                workspaceId: "ws-1",
                key: "a",
                name: "A",
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
      },
    );

    renderOverview("DEVELOPER");

    await waitFor(() => {
      expect(screen.getByText("1")).toBeTruthy();
    });

    setSelectedWorkspaceId("ws-2");
    window.dispatchEvent(new Event("osva-workspace-selected"));

    await waitFor(
      () => {
        expect(screen.getByText("0")).toBeTruthy();
      },
      { timeout: 5000 },
    );
  });
});
