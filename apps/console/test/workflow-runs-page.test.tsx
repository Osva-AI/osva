import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkflowRunsPage } from "../src/client/routes/workflow-runs-page";
import { setSelectedWorkspaceId } from "../src/client/lib/workspace-selection";
import { json, stubHumanSessionFetch } from "./human-auth-fetch-stub";

const ALL_RUNS = [
  {
    id: "wr-wait",
    workspaceId: "ws-1",
    workflowId: "wf-1",
    workflowVersionId: "wv-1",
    status: "WAITING",
    createdAt: "2026-02-02T00:00:00.000Z",
    updatedAt: "2026-02-02T00:00:01.000Z",
  },
  {
    id: "wr-ok",
    workspaceId: "ws-1",
    workflowId: "wf-1",
    workflowVersionId: "wv-1",
    status: "SUCCEEDED",
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:01.000Z",
  },
] as const;

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

function stubWorkflowListByStatus(
  onRequest?: (url: string) => void,
): ReturnType<typeof stubHumanSessionFetch> {
  return stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
    if (url.includes("/api/v1/workflow-runs")) {
      onRequest?.(url);
      if (url.includes("status=WAITING")) {
        return json({ workflowRuns: [ALL_RUNS[0]] });
      }
      if (url.includes("status=SUCCEEDED")) {
        return json({ workflowRuns: [ALL_RUNS[1]] });
      }
      if (url.includes("cursor=cursor-1")) {
        return json({
          workflowRuns: [
            {
              ...ALL_RUNS[1],
              id: "wr-page-2",
            },
          ],
        });
      }
      return json({ workflowRuns: [...ALL_RUNS], nextCursor: "cursor-1" });
    }
    return undefined;
  });
}

describe("WorkflowRunsPage", () => {
  beforeEach(() => {
    setSelectedWorkspaceId("ws-1");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows all statuses when no filter is selected", async () => {
    stubWorkflowListByStatus();
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("workflow-runs-history-list")).toBeTruthy();
    });
    const list = screen.getByTestId("workflow-runs-history-list");
    expect(within(list).getByRole("link", { name: /Waiting/i })).toBeTruthy();
    expect(within(list).getByRole("link", { name: /Succeeded/i })).toBeTruthy();
  });

  it("requests WAITING status and shows only waiting runs", async () => {
    const seen: string[] = [];
    stubWorkflowListByStatus((url) => {
      seen.push(url);
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("workflow-runs-history-list")).toBeTruthy();
    });

    await userEvent.selectOptions(screen.getByLabelText("Status"), "WAITING");

    await waitFor(() => {
      expect(seen.some((url) => url.includes("status=WAITING"))).toBe(true);
      const list = screen.getByTestId("workflow-runs-history-list");
      expect(within(list).getByRole("link", { name: /Waiting/i })).toBeTruthy();
      expect(
        within(list).queryByRole("link", { name: /Succeeded/i }),
      ).toBeNull();
    });
  });

  it("requests SUCCEEDED status and shows only succeeded runs", async () => {
    stubWorkflowListByStatus();
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("workflow-runs-history-list")).toBeTruthy();
    });

    await userEvent.selectOptions(screen.getByLabelText("Status"), "SUCCEEDED");

    await waitFor(() => {
      const list = screen.getByTestId("workflow-runs-history-list");
      expect(
        within(list).getByRole("link", { name: /Succeeded/i }),
      ).toBeTruthy();
      expect(within(list).queryByRole("link", { name: /Waiting/i })).toBeNull();
    });
  });

  it("reset filters restores the unfiltered list", async () => {
    stubWorkflowListByStatus();
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("workflow-runs-history-list")).toBeTruthy();
    });

    await userEvent.selectOptions(screen.getByLabelText("Status"), "WAITING");
    await waitFor(() => {
      expect(
        within(screen.getByTestId("workflow-runs-history-list")).queryByRole(
          "link",
          { name: /Succeeded/i },
        ),
      ).toBeNull();
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Reset filters" }),
    );

    await waitFor(() => {
      const list = screen.getByTestId("workflow-runs-history-list");
      expect(within(list).getByRole("link", { name: /Waiting/i })).toBeTruthy();
      expect(
        within(list).getByRole("link", { name: /Succeeded/i }),
      ).toBeTruthy();
    });
  });

  it("clears cursor when status filter changes", async () => {
    stubWorkflowListByStatus();
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("workflow-runs-history-list")).toBeTruthy();
    });

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(
        within(screen.getByTestId("workflow-runs-history-list"))
          .getByRole("link", { name: /Succeeded/i })
          .getAttribute("href"),
      ).toBe("/workflow-runs/wr-page-2");
    });

    await userEvent.selectOptions(screen.getByLabelText("Status"), "WAITING");
    await waitFor(() => {
      expect(
        within(screen.getByTestId("workflow-runs-history-list"))
          .getByRole("link", { name: /Waiting/i })
          .getAttribute("href"),
      ).toBe("/workflow-runs/wr-wait");
    });
    expect(
      (screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("supports status and workflow filters together", async () => {
    stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
      if (url.includes("status=WAITING") && url.includes("workflowId=wf-2")) {
        return json({
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
        });
      }
      if (url.includes("/api/v1/workflow-runs")) {
        return json({ workflowRuns: [] });
      }
      return undefined;
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByText("No workflow runs yet.")).toBeTruthy();
    });

    await userEvent.selectOptions(screen.getByLabelText("Status"), "WAITING");
    await userEvent.type(screen.getByLabelText("Workflow ID"), "wf-2");

    await waitFor(() => {
      expect(screen.getByTestId("workflow-runs-history-list")).toBeTruthy();
    });
    const row = screen
      .getByTestId("workflow-runs-history-list")
      .querySelector(".execution-history-v2-row-waiting");
    expect(row).toBeTruthy();
    expect(
      within(screen.getByTestId("workflow-runs-history-list"))
        .getByRole("link", { name: /Waiting/i })
        .getAttribute("href"),
    ).toBe("/workflow-runs/wr-9");
  });

  it("navigates cursor pages while preserving list filters", async () => {
    stubWorkflowListByStatus();
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("workflow-runs-history-list")).toBeTruthy();
    });
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(
        within(screen.getByTestId("workflow-runs-history-list"))
          .getByRole("link", { name: /Succeeded/i })
          .getAttribute("href"),
      ).toBe("/workflow-runs/wr-page-2");
    });
  });
});
