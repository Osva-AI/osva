import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "../src/client/components/app-shell/app-shell";
import { AuthProvider } from "../src/client/context/auth-context";
import { ACTIVITY_RECENT_LIMIT } from "../src/client/lib/activity-feed";
import { ActivityPage } from "../src/client/routes/activity-page";
import {
  getSelectedWorkspaceId,
  setSelectedWorkspaceId,
} from "../src/client/lib/workspace-selection";
import { json, stubHumanSessionFetch } from "./human-auth-fetch-stub";

function renderActivity() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/activity"]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/activity" element={<ActivityPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const baseRun = {
  agentId: "agent-1",
  effectiveBindings: {
    agentVersionId: "av-1",
    modelProfileVersionBindings: {},
    toolVersionBindings: {},
  },
  input: {},
  createdAt: "2026-01-01T00:00:00.000Z",
};

const baseWorkflowRun = {
  workspaceId: "ws-1",
  workflowId: "wf-1",
  workflowVersionId: "wv-1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("ActivityPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("requests bounded recent lists for both execution types", async () => {
    const fetchMock = stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
      if (url.includes("/api/v1/runs?")) {
        return json({ runs: [] });
      }
      if (url.includes("/api/v1/workflow-runs")) {
        return json({ workflowRuns: [] });
      }
      return undefined;
    });

    renderActivity();

    await waitFor(() => {
      expect(screen.getByText("No recent activity yet.")).toBeTruthy();
    });

    const runsCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/api/v1/runs?"),
    );
    const workflowCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/api/v1/workflow-runs"),
    );
    expect(String(runsCall?.[0])).toContain(`limit=${ACTIVITY_RECENT_LIMIT}`);
    expect(String(workflowCall?.[0])).toContain(
      `limit=${ACTIVITY_RECENT_LIMIT}`,
    );
  });

  it("merges feed rows by createdAt and uses one link per row", async () => {
    stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
      if (url.includes("/api/v1/runs?")) {
        return json({
          runs: [
            {
              ...baseRun,
              id: "run-agent-1",
              status: "RUNNING",
              createdAt: "2026-01-02T00:00:00.000Z",
              updatedAt: "2026-01-02T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes("/api/v1/workflow-runs")) {
        return json({
          workflowRuns: [
            {
              ...baseWorkflowRun,
              id: "wr-flow-1",
              status: "WAITING",
              createdAt: "2026-01-03T00:00:00.000Z",
              updatedAt: "2026-01-03T00:00:00.000Z",
            },
          ],
        });
      }
      return undefined;
    });

    renderActivity();

    await waitFor(() => {
      expect(screen.getByTestId("activity-recent-feed")).toBeTruthy();
    });

    const feed = screen.getByTestId("activity-recent-feed");
    const rowLinks = within(feed).getAllByRole("link");
    expect(rowLinks).toHaveLength(2);
    expect(rowLinks[0]?.getAttribute("href")).toBe("/workflow-runs/wr-flow-1");
    expect(rowLinks[1]?.getAttribute("href")).toBe("/runs/run-agent-1");
    expect(within(feed).getByText("Waiting")).toBeTruthy();
    expect(within(feed).getByText("Running")).toBeTruthy();
    expect(screen.getByTestId("activity-bounded-footnote")).toBeTruthy();
  });

  it("offers create links in the empty state", async () => {
    stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
      if (url.includes("/api/v1/runs")) {
        return json({ runs: [] });
      }
      if (url.includes("/api/v1/workflow-runs")) {
        return json({ workflowRuns: [] });
      }
      return undefined;
    });

    renderActivity();

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Create agent" })).toBeTruthy();
    });
    expect(
      screen.getByRole("link", { name: "Create agent" }).getAttribute("href"),
    ).toBe("/agents/new");
    expect(
      screen
        .getByRole("link", { name: "Create workflow" })
        .getAttribute("href"),
    ).toBe("/workflows/new");
  });

  it("navigates to full histories without tab semantics", async () => {
    stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
      if (url.includes("/api/v1/runs")) {
        return json({ runs: [] });
      }
      if (url.includes("/api/v1/workflow-runs")) {
        return json({ workflowRuns: [] });
      }
      return undefined;
    });

    renderActivity();

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Agent run history" }),
      ).toBeTruthy();
    });

    expect(
      screen
        .getByRole("link", { name: "Agent run history" })
        .getAttribute("href"),
    ).toBe("/runs");
    expect(
      screen
        .getByRole("link", { name: "Workflow run history" })
        .getAttribute("href"),
    ).toBe("/workflow-runs");
  });

  it("shows partial failure without empty-state copy", async () => {
    stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
      if (url.includes("/api/v1/runs?")) {
        return json({ error: "upstream" }, 500);
      }
      if (url.includes("/api/v1/workflow-runs")) {
        return json({
          workflowRuns: [
            {
              ...baseWorkflowRun,
              id: "wr-only",
              status: "SUCCEEDED",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      return undefined;
    });

    renderActivity();

    await waitFor(() => {
      expect(screen.getByTestId("activity-partial-failure")).toBeTruthy();
    });

    expect(screen.queryByText("No recent activity yet.")).toBeNull();
    expect(screen.getByText("Workflow run")).toBeTruthy();
  });

  it("shows error when both queries fail", async () => {
    stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
      if (url.includes("/api/v1/runs?")) {
        return json({ error: "runs down" }, 500);
      }
      if (url.includes("/api/v1/workflow-runs")) {
        return json({ error: "workflows down" }, 500);
      }
      return undefined;
    });

    renderActivity();

    await waitFor(() => {
      expect(screen.getByText("Could not load Activity")).toBeTruthy();
    });
    expect(screen.queryByTestId("activity-recent-feed")).toBeNull();
  });

  it("refetches both sources on Refresh", async () => {
    let runFetchCount = 0;
    const fetchMock = stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
      if (url.includes("/api/v1/runs?")) {
        runFetchCount += 1;
        return json({ runs: [] });
      }
      if (url.includes("/api/v1/workflow-runs")) {
        return json({ workflowRuns: [] });
      }
      return undefined;
    });

    renderActivity();
    await waitFor(() => {
      expect(screen.getByText("No recent activity yet.")).toBeTruthy();
    });

    const initialRunsCalls = runFetchCount;
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(runFetchCount).toBeGreaterThan(initialRunsCalls);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(2);
  });

  it("refetches when workspace selection changes", async () => {
    let runsFetchCount = 0;
    stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
      if (url.includes("/api/v1/runs?")) {
        runsFetchCount += 1;
        return json({ runs: [] });
      }
      if (url.includes("/api/v1/workflow-runs")) {
        return json({ workflowRuns: [] });
      }
      return undefined;
    });

    renderActivity();
    await waitFor(() => {
      expect(runsFetchCount).toBeGreaterThan(0);
    });
    const countBeforeSwitch = runsFetchCount;

    setSelectedWorkspaceId("ws-2");
    window.dispatchEvent(new Event("osva-workspace-selected"));

    await waitFor(() => {
      expect(getSelectedWorkspaceId()).toBe("ws-2");
      expect(runsFetchCount).toBeGreaterThan(countBeforeSwitch);
    });
  });
});
