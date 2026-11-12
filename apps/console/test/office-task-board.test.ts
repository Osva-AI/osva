import { describe, expect, it } from "vitest";

import type { OfficeAssignmentResource } from "../src/client/hooks/use-office";
import {
  filterOfficeTasks,
  groupAssignmentsByStatus,
  TASK_BOARD_COLUMNS,
} from "../src/client/lib/office-task-board";

function assignment(
  partial: Partial<OfficeAssignmentResource> & {
    readonly id: string;
    readonly status: OfficeAssignmentResource["status"];
  },
): OfficeAssignmentResource {
  return {
    workspaceId: "ws-1",
    officeWorkerId: "ow-1",
    title: partial.title ?? partial.id,
    targetType: "AGENT_VERSION",
    targetVersionId: "av-1",
    input: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("office task board", () => {
  const items = [
    assignment({ id: "a1", status: "PENDING", title: "Alpha draft", goalId: "g1" }),
    assignment({ id: "a2", status: "RUNNING", title: "Beta run", goalId: "g1" }),
    assignment({
      id: "a3",
      status: "COMPLETED",
      title: "Gamma done",
      officeWorkerId: "ow-2",
    }),
    assignment({ id: "a4", status: "FAILED", title: "Delta fail" }),
    assignment({ id: "a5", status: "CANCELLED", title: "Epsilon cancelled" }),
  ];

  it("groups assignments into board columns", () => {
    const grouped = groupAssignmentsByStatus(items);
    for (const status of TASK_BOARD_COLUMNS) {
      expect(grouped[status].every((row) => row.status === status)).toBe(true);
    }
    expect(grouped.PENDING).toHaveLength(1);
    expect(grouped.RUNNING).toHaveLength(1);
  });

  it("filters by mission, worker, status and search", () => {
    const filtered = filterOfficeTasks(items, {
      search: "beta",
      missionId: "g1",
      officeWorkerId: "",
      status: "ALL",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("a2");

    const byWorker = filterOfficeTasks(items, {
      search: "",
      missionId: "",
      officeWorkerId: "ow-2",
      status: "ALL",
    });
    expect(byWorker).toHaveLength(1);
    expect(byWorker[0]?.id).toBe("a3");
  });
});
