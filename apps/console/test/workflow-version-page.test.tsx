import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkflowVersionPage } from "../src/client/routes/workflow-version-page";

vi.mock("../src/client/components/workflow/workflow-graph-view", () => ({
  WorkflowGraphView: () => <div data-testid="workflow-graph-view-mock" />,
}));

function renderVersionPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/workflows/wf-1/versions/wv-1"]}>
        <Routes>
          <Route
            path="/workflows/:workflowId/versions/:workflowVersionId"
            element={<WorkflowVersionPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Workflow version page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders graph section with accessible fallbacks for V3 definitions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          id: "wv-1",
          workflowId: "wf-1",
          workspaceId: "ws-1",
          version: 1,
          definition: {
            schemaVersion: "3",
            nodes: [
              { key: "a", type: "AGENT", agentVersionId: "av-1" },
              { key: "b", type: "AGENT", agentVersionId: "av-2" },
            ],
            edges: [{ from: "a", to: "b" }],
          },
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      ),
    );

    renderVersionPage();

    await waitFor(() => {
      expect(screen.getByText("Definition (graph)")).toBeTruthy();
    });
    expect(
      screen.getByText(/For screen readers and text search/i),
    ).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId("workflow-graph-view-mock")).toBeTruthy();
    });
    expect(screen.getByText("Definition (structured)")).toBeTruthy();
    expect(screen.getByText("Definition (JSON)")).toBeTruthy();
    expect(screen.getByText(/a · AGENT/)).toBeTruthy();
  });

  it("skips graph for non-V3 definitions but keeps structured list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          id: "wv-2",
          workflowId: "wf-1",
          workspaceId: "ws-1",
          version: 2,
          definition: {
            schemaVersion: "2",
            nodes: [{ key: "a", type: "AGENT", agentVersionId: "av-1" }],
            edges: [],
          },
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      ),
    );

    renderVersionPage();

    await waitFor(() => {
      expect(screen.getByText(/schema version 3 only/i)).toBeTruthy();
    });
    expect(screen.queryByTestId("workflow-graph-view-mock")).toBeNull();
    expect(screen.getByText("Definition (structured)")).toBeTruthy();
  });
});
