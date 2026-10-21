import { describe, expect, it } from "vitest";

import {
  collectAttentionFromRecentRuns,
  collectAttentionFromRecentWorkflowRuns,
} from "../src/client/lib/overview-attention";
import {
  presentRecentList,
  presentRegistryCount,
} from "../src/client/lib/overview-counts";

describe("overview helpers", () => {
  it("qualifies registry totals", () => {
    const view = presentRegistryCount(3, "Agents");
    expect(view.detail).toMatch(/full registry list/i);
  });

  it("marks paginated run lists as recent only", () => {
    const view = presentRecentList(5, 8, "next", "Runs");
    expect(view.hasMore).toBe(true);
    expect(view.shown).toBe(5);
  });

  it("classifies failed and waiting executions from API statuses", () => {
    const runs = collectAttentionFromRecentRuns([
      {
        id: "r1",
        agentId: "a1",
        status: "FAILED",
        effectiveBindings: {
          agentVersionId: "av",
          modelProfileVersionBindings: {},
          toolVersionBindings: {},
        },
        input: {},
        createdAt: "",
        updatedAt: "",
      },
    ]);
    expect(runs[0]?.attentionKind).toBe("failed");

    const workflowRuns = collectAttentionFromRecentWorkflowRuns([
      {
        id: "wr1",
        workspaceId: "ws",
        workflowId: "w1",
        workflowVersionId: "wv1",
        status: "WAITING",
        createdAt: "",
        updatedAt: "",
      },
    ]);
    expect(workflowRuns[0]?.attentionKind).toBe("waiting");
  });
});
