import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../src/client/context/auth-context";
import { OfficeMissionDetailPage } from "../src/client/routes/office-mission-detail-page";
import { OfficeMissionsPage } from "../src/client/routes/office-missions-page";
import { OfficeTaskCreatePage } from "../src/client/routes/office-task-create-page";
import { json, stubHumanSessionFetch } from "./human-auth-fetch-stub";

function wrap(
  ui: ReactElement,
  initialEntries: string[] = ["/office/missions"],
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/office/missions" element={ui} />
            <Route
              path="/office/missions/:missionId"
              element={<OfficeMissionDetailPage />}
            />
            <Route
              path="/office/tasks/new"
              element={<OfficeTaskCreatePage />}
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const goalA = {
  id: "goal-a",
  workspaceId: "ws-office",
  key: "launch",
  title: "Launch mission",
  description: "Q1 launch",
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

function officeStub(
  role: string,
  options?: {
    readonly onPostGoal?: (body: unknown) => void;
    readonly onPostAssignment?: (body: unknown) => void;
    readonly onPatchGoal?: (body: unknown) => void;
  },
) {
  return stubHumanSessionFetch(role, "ws-office", (url, init) => {
    const path = String(url);
    if (
      path === "/api/v1/office/goals" ||
      path.endsWith("/api/v1/office/goals")
    ) {
      if (init?.method === "POST") {
        options?.onPostGoal?.(JSON.parse(String(init.body)));
        return json({
          ...goalA,
          id: "goal-new",
          title: "New mission",
        });
      }
      return json({ items: [goalA] });
    }
    if (
      path.includes(`/api/v1/office/goals/${goalA.id}`) &&
      !path.endsWith("/goals")
    ) {
      if (init?.method === "PATCH") {
        options?.onPatchGoal?.(JSON.parse(String(init.body)));
        return json({ ...goalA, status: "ACTIVE", title: "Launch mission" });
      }
      return json(goalA);
    }
    if (
      path === "/api/v1/office/assignments" ||
      path.endsWith("/api/v1/office/assignments")
    ) {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        options?.onPostAssignment?.(body);
        return json({
          id: "asn-new",
          workspaceId: "ws-office",
          goalId: body.goalId,
          officeWorkerId: body.officeWorkerId,
          title: body.title,
          targetType: body.targetType,
          targetVersionId: body.targetVersionId,
          input: body.input,
          status: "PENDING",
          createdAt: "2026-01-03T00:00:00.000Z",
        });
      }
      return json({
        items: [
          {
            id: "asn-1",
            workspaceId: "ws-office",
            goalId: goalA.id,
            officeWorkerId: worker.id,
            title: "Draft post",
            targetType: "AGENT_VERSION",
            targetVersionId: "av-1",
            input: {},
            status: "COMPLETED",
            createdAt: "2026-01-02T00:00:00.000Z",
          },
          {
            id: "asn-2",
            workspaceId: "ws-office",
            goalId: goalA.id,
            officeWorkerId: worker.id,
            title: "Review",
            targetType: "AGENT_VERSION",
            targetVersionId: "av-1",
            input: {},
            status: "PENDING",
            createdAt: "2026-01-03T00:00:00.000Z",
          },
        ],
      });
    }
    if (url === "/api/v1/office/workers") {
      return json({ items: [worker] });
    }
    if (url === "/api/v1/office/teams") {
      return json({ items: [] });
    }
    if (url === "/api/v1/agents") {
      return json({ agents: [{ id: "agent-1", key: "a1", name: "Agent 1" }] });
    }
    if (url === "/api/v1/agents/agent-1/versions") {
      return json({
        versions: [
          {
            id: "av-1",
            agentId: "agent-1",
            version: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      });
    }
    if (url === "/api/v1/workflows") {
      return json({
        workflows: [
          { id: "wf-1", workspaceId: "ws-office", key: "w", name: "W" },
        ],
      });
    }
    if (url === "/api/v1/workflows/wf-1/versions") {
      return json({
        versions: [
          {
            id: "wv-1",
            workflowId: "wf-1",
            workspaceId: "ws-office",
            version: 1,
            definition: { schemaVersion: "3", nodes: [], edges: [] },
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      });
    }
    return undefined;
  });
}

describe("Office Missions UI", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders mission list with progress and supports status filter", async () => {
    officeStub("DEVELOPER");
    wrap(<OfficeMissionsPage />);

    await waitFor(() => {
      expect(screen.getByText("Launch mission")).toBeTruthy();
    });
    expect(screen.getByTestId("mission-progress-summary")).toBeTruthy();
    expect(screen.getByText(/1 \/ 2 completed/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "COMPLETED" },
    });
    expect(screen.getByText(/No missions match your filters/i)).toBeTruthy();
  });

  it("creates a mission via POST goals", async () => {
    const user = userEvent.setup();
    let posted: unknown;
    officeStub("DEVELOPER", {
      onPostGoal: (body) => {
        posted = body;
      },
    });

    wrap(<OfficeMissionsPage />, ["/office/missions?create=1"]);

    await waitFor(() => screen.getByLabelText("Title"));

    await user.type(screen.getByLabelText("Title"), "New mission");
    await user.click(screen.getByRole("button", { name: "Create Mission" }));

    await waitFor(() => {
      expect(posted).toEqual(expect.objectContaining({ title: "New mission" }));
    });
  });

  it("hides mission create for VIEWER", async () => {
    officeStub("VIEWER");
    wrap(<OfficeMissionsPage />);

    await waitFor(() => screen.getByText("Launch mission"));
    expect(screen.queryByRole("link", { name: "Create Mission" })).toBeNull();
  });

  it("renders mission detail and updates status", async () => {
    const user = userEvent.setup();
    let patched: unknown;
    officeStub("DEVELOPER", {
      onPatchGoal: (body) => {
        patched = body;
      },
    });

    wrap(<OfficeMissionDetailPage />, [`/office/missions/${goalA.id}`]);

    await waitFor(() => {
      expect(screen.getByText("Launch mission")).toBeTruthy();
    });
    expect(screen.getAllByText("Writer").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Draft post").length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByLabelText("Goal status"), "ACTIVE");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(patched).toEqual(expect.objectContaining({ status: "ACTIVE" }));
    });
  });

  it("creates agent-version task without launch", async () => {
    const user = userEvent.setup();
    let posted: unknown;
    officeStub("DEVELOPER", {
      onPostAssignment: (body) => {
        posted = body;
      },
    });

    wrap(<OfficeTaskCreatePage />, ["/office/tasks/new"]);

    await waitFor(() => screen.getByLabelText("Title"));

    await user.type(screen.getByLabelText("Title"), "Write copy");
    await user.selectOptions(screen.getByLabelText("Office Worker"), worker.id);
    await user.selectOptions(screen.getByLabelText("Agent version"), "av-1");

    await user.click(screen.getByRole("button", { name: "Create Task" }));

    await waitFor(() => {
      expect(posted).toEqual(
        expect.objectContaining({
          title: "Write copy",
          targetType: "AGENT_VERSION",
          targetVersionId: "av-1",
          officeWorkerId: worker.id,
        }),
      );
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    const launchCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/launch"),
    );
    expect(launchCalls).toHaveLength(0);
  });

  it("creates workflow-version task", async () => {
    const user = userEvent.setup();
    let posted: unknown;
    officeStub("DEVELOPER", {
      onPostAssignment: (body) => {
        posted = body;
      },
    });

    wrap(<OfficeTaskCreatePage />, ["/office/tasks/new"]);

    await waitFor(() => screen.getByLabelText("Title"));

    await user.selectOptions(
      screen.getByLabelText("Target type"),
      "WORKFLOW_VERSION",
    );
    await user.type(screen.getByLabelText("Title"), "Run flow");
    await user.selectOptions(screen.getByLabelText("Office Worker"), worker.id);
    await user.selectOptions(screen.getByLabelText("Workflow version"), "wv-1");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    await waitFor(() => {
      expect(posted).toEqual(
        expect.objectContaining({
          targetType: "WORKFLOW_VERSION",
          targetVersionId: "wv-1",
        }),
      );
    });
  });

  it("rejects invalid JSON and blocks submit", async () => {
    officeStub("DEVELOPER");
    wrap(<OfficeTaskCreatePage />, ["/office/tasks/new"]);

    await waitFor(() => screen.getByLabelText("Input (JSON)"));
    fireEvent.change(screen.getByLabelText("Input (JSON)"), {
      target: { value: "{bad-json" },
    });

    const submit = screen.getByRole("button", {
      name: "Create Task",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("blocks OPERATOR from task creation UI", async () => {
    officeStub("OPERATOR");
    wrap(<OfficeTaskCreatePage />, ["/office/tasks/new"]);

    await waitFor(() =>
      expect(screen.getByText(/read-only access/i)).toBeTruthy(),
    );
    expect(screen.queryByLabelText("Title")).toBeNull();
  });

  it("sends workspace header on assignment create", async () => {
    const fetchMock = officeStub("DEVELOPER");
    wrap(<OfficeTaskCreatePage />, ["/office/tasks/new"]);

    await waitFor(() => screen.getByLabelText("Title"));

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Title"), "Pinned");
    await user.selectOptions(screen.getByLabelText("Office Worker"), worker.id);
    await user.selectOptions(screen.getByLabelText("Agent version"), "av-1");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url) === "/api/v1/office/assignments" &&
          init?.method === "POST",
      );
      expect(postCall).toBeTruthy();
      const headers = new Headers(postCall?.[1]?.headers);
      expect(headers.get("x-osva-workspace-id")).toBe("ws-office");
    });
  });

  it("shows missions section nav link", async () => {
    officeStub("DEVELOPER");
    wrap(<OfficeMissionsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText("Virtual Office views")).toBeTruthy();
    });
    expect(
      screen
        .getByLabelText("Virtual Office views")
        .querySelector("[aria-current]")?.textContent,
    ).toBe("Missions");
    expect(screen.getByRole("link", { name: "Tasks" })).toBeTruthy();
  });
});
