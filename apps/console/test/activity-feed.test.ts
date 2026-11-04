import { describe, expect, it } from "vitest";

import {
  ACTIVITY_RECENT_LIMIT,
  activityExecutionStatusLabel,
  buildActivityFeedRows,
  shortenResourceId,
} from "../src/client/lib/activity-feed";

describe("activity-feed", () => {
  it("uses bounded recent limit constant of 25", () => {
    expect(ACTIVITY_RECENT_LIMIT).toBe(25);
  });

  it("sorts merged rows by createdAt descending", () => {
    const rows = buildActivityFeedRows({
      agentRuns: [
        {
          id: "run-newer",
          agentId: "agent-1",
          status: "SUCCEEDED",
          effectiveBindings: {
            agentVersionId: "av-1",
            modelProfileVersionBindings: {},
            toolVersionBindings: {},
          },
          input: {},
          createdAt: "2026-01-03T00:00:00.000Z",
          updatedAt: "2026-01-03T00:00:01.000Z",
        },
      ],
      workflowRuns: [
        {
          id: "wr-older",
          workspaceId: "ws-1",
          workflowId: "wf-1",
          workflowVersionId: "wv-1",
          status: "RUNNING",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-04T00:00:00.000Z",
        },
      ],
    });

    expect(rows.map((row) => row.id)).toEqual(["run-newer", "wr-older"]);
  });

  it("ranks by createdAt even when an older run has a more recent update", () => {
    const rows = buildActivityFeedRows({
      agentRuns: [
        {
          id: "run-stale-create",
          agentId: "agent-1",
          status: "SUCCEEDED",
          effectiveBindings: {
            agentVersionId: "av-1",
            modelProfileVersionBindings: {},
            toolVersionBindings: {},
          },
          input: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-10T00:00:00.000Z",
        },
      ],
      workflowRuns: [
        {
          id: "wr-fresh-create",
          workspaceId: "ws-1",
          workflowId: "wf-1",
          workflowVersionId: "wv-1",
          status: "RUNNING",
          createdAt: "2026-01-05T00:00:00.000Z",
          updatedAt: "2026-01-05T00:00:01.000Z",
        },
      ],
    });

    expect(rows.map((row) => row.id)).toEqual([
      "wr-fresh-create",
      "run-stale-create",
    ]);
  });

  it("preserves type distinction and canonical links", () => {
    const rows = buildActivityFeedRows({
      agentRuns: [
        {
          id: "run-abc",
          agentId: "agent-1",
          status: "QUEUED",
          effectiveBindings: {
            agentVersionId: "av-1",
            modelProfileVersionBindings: {},
            toolVersionBindings: {},
          },
          input: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
        },
      ],
      workflowRuns: [
        {
          id: "wr-xyz",
          workspaceId: "ws-1",
          workflowId: "wf-1",
          workflowVersionId: "wv-1",
          status: "WAITING",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:02.000Z",
        },
      ],
    });

    const agent = rows.find((row) => row.kind === "agent");
    const workflow = rows.find((row) => row.kind === "workflow");
    expect(agent?.href).toBe("/runs/run-abc");
    expect(workflow?.href).toBe("/workflow-runs/wr-xyz");
    expect(agent?.statusLabel).toBe("Queued");
    expect(workflow?.statusLabel).toBe("Waiting");
  });

  it("shortens long resource ids for display", () => {
    const longId = "run-0123456789abcdef0123456789abcdef";
    expect(shortenResourceId(longId)).toBe("run-0123…cdef");
  });

  it("labels unexpected statuses without throwing", () => {
    expect(activityExecutionStatusLabel("CUSTOM_STATE")).toBe("Custom state");
  });
});
