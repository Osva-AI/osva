import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkflowRunsPage } from "../src/client/routes/workflow-runs-page";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WorkflowRunsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WorkflowRunsPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("supports status and workflow filters", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("status=WAITING") && url.includes("workflowId=wf-2")) {
        return new Response(
          JSON.stringify({
            workflowRuns: [
              {
                id: "wr-9",
                workspaceId: "ws-1",
                workflowId: "wf-2",
                workflowVersionId: "wv-2",
                status: "WAITING",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ workflowRuns: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    await waitFor(() => {
      expect(screen.getByText("No workflow runs yet.")).toBeTruthy();
    });

    await userEvent.selectOptions(screen.getByLabelText("Status"), "WAITING");
    await userEvent.type(screen.getByLabelText("Workflow ID"), "wf-2");

    await waitFor(() => {
      expect(screen.getByText("wr-9")).toBeTruthy();
    });
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("workflowVersionId"),
      ),
    ).toBe(false);
  });

  it("navigates cursor pages", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("cursor=cursor-1")) {
        return new Response(
          JSON.stringify({
            workflowRuns: [
              {
                id: "wr-2",
                workspaceId: "ws-1",
                workflowId: "wf-1",
                workflowVersionId: "wv-1",
                status: "SUCCEEDED",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          workflowRuns: [
            {
              id: "wr-1",
              workspaceId: "ws-1",
              workflowId: "wf-1",
              workflowVersionId: "wv-1",
              status: "RUNNING",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          nextCursor: "cursor-1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    await waitFor(() => {
      expect(screen.getByText("wr-1")).toBeTruthy();
    });
    const nextButtons = screen.getAllByRole("button", { name: "Next" });
    await userEvent.click(nextButtons[nextButtons.length - 1]!);
    await waitFor(() => {
      expect(screen.getByText("wr-2")).toBeTruthy();
    });
  });
});
