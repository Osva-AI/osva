import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../src/client/context/auth-context";
import { OfficeWorkerDetailPage } from "../src/client/routes/office-worker-detail-page";
import { clearSelectedWorkspaceId } from "../src/client/lib/workspace-selection";
import { json, stubHumanSessionFetch } from "./human-auth-fetch-stub";

function wrap(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/office/workers/ow-1"]}>
          <Routes>
            <Route path="/office/workers/:workerId" element={ui} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("office worker execution activity", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    clearSelectedWorkspaceId();
  });

  it("lists recent assignments for the worker from workspace list cache", async () => {
    stubHumanSessionFetch("VIEWER", "ws-office", (url) => {
      const path = String(url);
      if (path.includes("/api/v1/office/workers/ow-1")) {
        return json({
          id: "ow-1",
          workspaceId: "ws-office",
          key: "writer",
          name: "Writer",
          agentId: "agent-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        });
      }
      if (path === "/api/v1/office/assignments") {
        return json({
          items: [
            {
              id: "asn-1",
              workspaceId: "ws-office",
              officeWorkerId: "ow-1",
              goalId: "goal-1",
              title: "Recent task",
              targetType: "AGENT_VERSION",
              targetVersionId: "av-1",
              input: {},
              status: "COMPLETED",
              runId: "run-1",
              createdAt: "2026-01-02T00:00:00.000Z",
              completedAt: "2026-01-02T01:00:00.000Z",
            },
          ],
        });
      }
      if (path === "/api/v1/office/goals") {
        return json({
          items: [
            {
              id: "goal-1",
              workspaceId: "ws-office",
              key: "g",
              title: "Mission Alpha",
              status: "OPEN",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (
        path.includes("/api/v1/agents/agent-1") &&
        !path.includes("versions")
      ) {
        return json({
          id: "agent-1",
          workspaceId: "ws-office",
          key: "a",
          name: "Agent",
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      if (path === "/api/v1/office/teams") {
        return json({ items: [] });
      }
      if (path === "/api/v1/office/roles") {
        return json({ items: [] });
      }
      return undefined;
    });

    wrap(<OfficeWorkerDetailPage />);

    await waitFor(() =>
      expect(screen.getByTestId("worker-assignment-activity")).toBeTruthy(),
    );
    expect(screen.getAllByText("Recent task").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mission Alpha").length).toBeGreaterThan(0);
  });
});
