import type { ReactElement } from "react";
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

import { AuthProvider } from "../src/client/context/auth-context";
import { OfficeTaskDetailPage } from "../src/client/routes/office-task-detail-page";
import { OfficeTasksBoardPage } from "../src/client/routes/office-tasks-board-page";
import { setSelectedWorkspaceId } from "../src/client/lib/workspace-selection";
import { json, stubHumanSessionFetch } from "./human-auth-fetch-stub";

const goalA = {
  id: "goal-a",
  workspaceId: "ws-office",
  key: "launch",
  title: "Launch mission",
  status: "OPEN" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

const worker = {
  id: "ow-1",
  workspaceId: "ws-office",
  key: "writer",
  name: "Writer",
  agentId: "agent-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const assignments = {
  pending: {
    id: "asn-pending",
    workspaceId: "ws-office",
    goalId: goalA.id,
    officeWorkerId: worker.id,
    title: "Pending task",
    targetType: "AGENT_VERSION" as const,
    targetVersionId: "av-1",
    input: { k: 1 },
    status: "PENDING" as const,
    createdAt: "2026-01-03T00:00:00.000Z",
  },
  running: {
    id: "asn-running",
    workspaceId: "ws-office",
    goalId: goalA.id,
    officeWorkerId: worker.id,
    title: "Running task",
    targetType: "AGENT_VERSION" as const,
    targetVersionId: "av-1",
    input: {},
    status: "RUNNING" as const,
    runId: "run-1",
    createdAt: "2026-01-02T00:00:00.000Z",
    startedAt: "2026-01-02T00:01:00.000Z",
  },
  workflow: {
    id: "asn-wf",
    workspaceId: "ws-office",
    officeWorkerId: worker.id,
    title: "Workflow task",
    targetType: "WORKFLOW_VERSION" as const,
    targetVersionId: "wv-1",
    input: {},
    status: "COMPLETED" as const,
    workflowRunId: "wfr-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:01:00.000Z",
    completedAt: "2026-01-01T00:02:00.000Z",
  },
};

function wrap(ui: ReactElement, initialEntries: string[] = ["/office/tasks"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/office/tasks" element={ui} />
            <Route
              path="/office/tasks/:taskId"
              element={<OfficeTaskDetailPage />}
            />
            <Route
              path="/runs/:runId"
              element={<div data-testid="run-page" />}
            />
            <Route
              path="/workflow-runs/:workflowRunId"
              element={<div data-testid="workflow-run-page" />}
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function officeStub(
  role: string,
  options?: {
    readonly onLaunch?: () => void;
    readonly onCancel?: () => void;
  },
) {
  let pendingDetail = { ...assignments.pending };
  return stubHumanSessionFetch(role, "ws-office", (url, init) => {
    const path = String(url);
    if (path.endsWith("/api/v1/office/goals") && !path.includes("/goals/")) {
      return json({ items: [goalA] });
    }
    if (path.includes(`/api/v1/office/goals/${goalA.id}`)) {
      return json(goalA);
    }
    if (path === "/api/v1/office/workers") {
      return json({ items: [worker] });
    }
    if (path.includes("/api/v1/office/workers/")) {
      return json(worker);
    }
    if (path.endsWith("/api/v1/office/assignments") && init?.method !== "POST") {
      return json({
        items: [assignments.pending, assignments.running, assignments.workflow],
      });
    }
    if (path.includes("/assignments/asn-pending/launch")) {
      options?.onLaunch?.();
      pendingDetail = {
        ...pendingDetail,
        status: "RUNNING",
        runId: "run-launched",
        startedAt: "2026-01-03T01:00:00.000Z",
      };
      return json(pendingDetail);
    }
    if (path.includes("/assignments/asn-pending/cancel")) {
      options?.onCancel?.();
      pendingDetail = {
        ...pendingDetail,
        status: "CANCELLED",
        cancelledAt: "2026-01-03T01:00:00.000Z",
      };
      return json(pendingDetail);
    }
    if (path.includes("/assignments/asn-pending") && init?.method !== "POST") {
      return json(pendingDetail);
    }
    if (path.includes("/assignments/asn-running")) {
      return json(assignments.running);
    }
    if (path.includes("/assignments/asn-wf")) {
      return json(assignments.workflow);
    }
    if (path.includes("/api/v1/runs/run-1")) {
      return json({
        id: "run-1",
        agentId: "agent-1",
        status: "RUNNING",
        effectiveBindings: {
          agentVersionId: "av-1",
          modelProfileVersionBindings: {},
          toolVersionBindings: {},
        },
        input: {},
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      });
    }
    if (path.includes("/api/v1/runs/run-1/attempts")) {
      return json({ attempts: [] });
    }
    if (path.includes("/api/v1/workflow-runs/wfr-1")) {
      return json({
        id: "wfr-1",
        workflowId: "wf-1",
        workflowVersionId: "wv-1",
        status: "SUCCEEDED",
        input: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:02:00.000Z",
        nodeRuns: [],
      });
    }
    return undefined;
  });
}

describe("office tasks ui", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    setSelectedWorkspaceId(undefined);
  });

  it("renders board columns and filters by mission", async () => {
    officeStub("DEVELOPER");
    wrap(<OfficeTasksBoardPage />);

    await waitFor(() =>
      expect(screen.getByTestId("office-task-board-columns")).toBeTruthy(),
    );

    expect(screen.getByTestId("task-column-PENDING")).toBeTruthy();
    expect(screen.getByTestId("task-column-RUNNING")).toBeTruthy();

    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByLabelText("Mission"),
      goalA.id,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("task-card-asn-wf")).toBeNull();
    });
    expect(screen.getByTestId("task-card-asn-pending")).toBeTruthy();
  });

  it("shows OPERATOR launch on detail but not for VIEWER", async () => {
    officeStub("OPERATOR");
    wrap(<OfficeTaskDetailPage />, ["/office/tasks/asn-pending"]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Launch" })).toBeTruthy(),
    );

    cleanup();
    officeStub("VIEWER");
    wrap(<OfficeTaskDetailPage />, ["/office/tasks/asn-pending"]);

    await waitFor(() =>
      expect(screen.getByTestId("office-task-detail-page")).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: "Launch" })).toBeNull();
  });

  it("launches with confirmation and navigates to run", async () => {
    let launches = 0;
    officeStub("OPERATOR", { onLaunch: () => (launches += 1) });
    wrap(<OfficeTaskDetailPage />, ["/office/tasks/asn-pending"]);

    await waitFor(() => screen.getByRole("button", { name: "Launch" }));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Launch" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Launch" }));

    await waitFor(() => {
      expect(launches).toBe(1);
      expect(screen.getByTestId("run-page")).toBeTruthy();
    });
  });

  it("cancels pending assignment and surfaces domain errors", async () => {
    officeStub("OPERATOR", { onCancel: () => undefined });
    wrap(<OfficeTaskDetailPage />, ["/office/tasks/asn-pending"]);

    await waitFor(() => screen.getByRole("button", { name: "Cancel task" }));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancel task" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Cancel task" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Launch" })).toBeNull(),
    );
  });

  it("links workflow and run execution from detail", async () => {
    officeStub("VIEWER");
    wrap(<OfficeTaskDetailPage />, ["/office/tasks/asn-wf"]);

    await waitFor(() =>
      expect(screen.getByTestId("task-execution-link")).toHaveAttribute(
        "href",
        "/workflow-runs/wfr-1",
      ),
    );
  });
});
