import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkflowDetailPage } from "../src/client/routes/workflow-detail-page";
import { WorkflowsPage } from "../src/client/routes/workflows-page";

function renderApp(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/workflows" element={<WorkflowsPage />} />
          <Route
            path="/workflows/:workflowId"
            element={<WorkflowDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Workflows UI", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders workflows list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/v1/workflows") && !url.includes("/versions")) {
          return new Response(
            JSON.stringify({
              workflows: [
                {
                  id: "wf-1",
                  workspaceId: "ws-1",
                  key: "demo",
                  name: "Demo Workflow",
                  createdAt: "2026-01-01T00:00:00.000Z",
                  updatedAt: "2026-01-01T00:00:00.000Z",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ workflows: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    renderApp("/workflows");
    await waitFor(() => {
      expect(screen.getByText("Demo Workflow")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: "wf-1" })).toBeTruthy();
  });

  it("opens workflow detail with versions and recent runs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/v1/workflows/wf-1/versions")) {
          return new Response(
            JSON.stringify({
              versions: [
                {
                  id: "wv-1",
                  workflowId: "wf-1",
                  workspaceId: "ws-1",
                  version: 1,
                  definition: { schemaVersion: "1", nodes: [], edges: [] },
                  createdAt: "2026-01-01T00:00:00.000Z",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (
          url.includes("/api/v1/workflow-runs?") &&
          url.includes("workflowId=wf-1")
        ) {
          return new Response(
            JSON.stringify({
              workflowRuns: [
                {
                  id: "wr-1",
                  workspaceId: "ws-1",
                  workflowId: "wf-1",
                  workflowVersionId: "wv-1",
                  status: "PENDING",
                  createdAt: "2026-01-01T00:00:00.000Z",
                  updatedAt: "2026-01-01T00:00:00.000Z",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (
          url.includes("/api/v1/workflows/wf-1") &&
          !url.includes("/versions")
        ) {
          return new Response(
            JSON.stringify({
              id: "wf-1",
              workspaceId: "ws-1",
              key: "demo",
              name: "Demo Workflow",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({}), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    renderApp("/workflows/wf-1");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Workflow" })).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "wv-1" })).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: "wr-1" })).toBeTruthy();
  });
});
