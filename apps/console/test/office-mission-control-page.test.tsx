import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "../src/client/components/app-shell/app-shell";
import { AuthProvider } from "../src/client/context/auth-context";
import { OfficeMissionControlPage } from "../src/client/routes/office-mission-control-page";
import { summarizeAssignmentCounts } from "../src/client/hooks/use-office";
import { json, stubHumanSessionFetch } from "./human-auth-fetch-stub";

describe("Office Mission Control", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("derives assignment metric counts from API data", () => {
    const counts = summarizeAssignmentCounts([
      {
        id: "a1",
        workspaceId: "ws-1",
        officeWorkerId: "w1",
        title: "T",
        targetType: "AGENT_VERSION",
        targetVersionId: "av-1",
        input: {},
        status: "PENDING",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "a2",
        workspaceId: "ws-1",
        officeWorkerId: "w1",
        title: "T2",
        targetType: "AGENT_VERSION",
        targetVersionId: "av-1",
        input: {},
        status: "RUNNING",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "a3",
        workspaceId: "ws-1",
        officeWorkerId: "w1",
        title: "T3",
        targetType: "AGENT_VERSION",
        targetVersionId: "av-1",
        input: {},
        status: "COMPLETED",
        createdAt: "2026-01-03T00:00:00.000Z",
      },
    ]);
    expect(counts).toEqual({
      pending: 1,
      running: 1,
      completed: 1,
      failed: 0,
    });
  });

  it("renders overview metrics from office API responses", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-office", (url) => {
      if (url === "/api/v1/office/workers") {
        return json({
          items: [
            {
              id: "ow-1",
              workspaceId: "ws-office",
              key: "writer",
              name: "Writer",
              agentId: "agent-1",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (url === "/api/v1/office/teams") {
        return json({
          items: [
            {
              id: "team-1",
              workspaceId: "ws-office",
              key: "core",
              name: "Core",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (url === "/api/v1/office/assignments") {
        return json({ items: [] });
      }
      if (url === "/api/v1/office/teams/team-1/memberships") {
        return json({
          items: [{ teamId: "team-1", officeWorkerId: "ow-1" }],
        });
      }
      if (url === "/api/v1/agents") {
        return json({
          agents: [
            {
              id: "agent-1",
              workspaceId: "ws-office",
              key: "writer",
              name: "Writer Agent",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      return undefined;
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={["/office"]}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/office" element={<OfficeMissionControlPage />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("office-overview-metrics")).toBeTruthy();
    });

    const metrics = screen.getByTestId("office-overview-metrics");
    expect(metrics.textContent).toContain("Registered workers");
    expect(metrics.textContent).toContain("1");
    expect(
      screen.getByRole("heading", { name: "Virtual Office" }),
    ).toBeTruthy();
    expect(screen.queryByText(/online|offline|executing now/i)).toBeNull();
  });
});
