import { describe, expect, it } from "vitest";

import type { WorkspaceId } from "@osva-ai/contracts";

import type { OfficeAssignmentResource } from "../src/client/hooks/use-office";
import { buildWorkspaceOfficeActivityFeed } from "../src/client/lib/office-activity";

function assignment(
  overrides: Partial<OfficeAssignmentResource> &
    Pick<OfficeAssignmentResource, "id" | "title">,
): OfficeAssignmentResource {
  return {
    workspaceId: "ws-1",
    officeWorkerId: "ow-1",
    targetType: "AGENT_VERSION",
    targetVersionId: "av-1",
    input: {},
    status: "COMPLETED",
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:01:00.000Z",
    completedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("console office activity feed", () => {
  it("does not perform mutations when building the feed", () => {
    const feed = buildWorkspaceOfficeActivityFeed({
      workspaceId: "ws-1" as WorkspaceId,
      assignments: [
        assignment({
          id: "asn-1",
          title: "Draft memo",
          runId: "run-1",
        }),
      ],
      workflowRuns: [],
      workflowRunResources: [],
      artifacts: [],
      workers: [
        {
          id: "ow-1",
          workspaceId: "ws-1",
          key: "writer",
          name: "Writer",
          agentId: "agent-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(feed.entries.length).toBeGreaterThan(0);
    expect(feed.entries.every((row) => row.workspaceId === "ws-1")).toBe(true);
  });

  it("isolates foreign workspace assignments", () => {
    const feed = buildWorkspaceOfficeActivityFeed({
      workspaceId: "ws-1" as WorkspaceId,
      assignments: [
        assignment({
          id: "asn-foreign",
          title: "Foreign",
          workspaceId: "ws-2",
        }),
      ],
      workflowRuns: [],
      workflowRunResources: [],
      artifacts: [],
      workers: [],
    });
    expect(feed.entries).toHaveLength(0);
  });
});
