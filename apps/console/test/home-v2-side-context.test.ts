import { describe, expect, it } from "vitest";

import { selectHomeResumeTarget } from "../src/client/lib/home-v2-resume";
import { selectHomeSideContext } from "../src/client/lib/home-v2-side-context";
import type { AttentionRunItem } from "../src/client/lib/overview-attention";

describe("selectHomeSideContext", () => {
  it("shows agent beside workflow resume target", () => {
    const resume = selectHomeResumeTarget({
      agents: [
        {
          id: "a1",
          workspaceId: "ws-1",
          key: "support",
          name: "Support assistant",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      workflows: [
        {
          id: "w1",
          workspaceId: "ws-1",
          key: "triage",
          name: "Support triage",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-10T00:00:00.000Z",
        },
      ],
      recentRuns: [],
    });
    const side = selectHomeSideContext({
      resume,
      agents: [
        {
          id: "a1",
          workspaceId: "ws-1",
          key: "support",
          name: "Support assistant",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      workflows: [
        {
          id: "w1",
          workspaceId: "ws-1",
          key: "triage",
          name: "Support triage",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-10T00:00:00.000Z",
        },
      ],
      recentRuns: [],
      attentionItems: [],
    });
    expect(resume?.kind).toBe("workflow");
    expect(side.resource?.kind).toBe("agent");
    expect(side.resource?.name).toBe("Support assistant");
  });

  it("embeds failed run attention when no side resource", () => {
    const failed: AttentionRunItem = {
      kind: "run",
      id: "run-fail",
      status: "FAILED",
      attentionKind: "failed",
      agentId: "a1",
      updatedAt: "2026-01-11T00:00:00.000Z",
    };
    const resume = selectHomeResumeTarget({
      agents: [
        {
          id: "a1",
          workspaceId: "ws-1",
          key: "solo",
          name: "Only agent",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      workflows: [],
      recentRuns: [],
    });
    const side = selectHomeSideContext({
      resume,
      agents: [
        {
          id: "a1",
          workspaceId: "ws-1",
          key: "solo",
          name: "Only agent",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      workflows: [],
      recentRuns: [],
      attentionItems: [failed],
    });
    expect(side.resource).toBeUndefined();
    expect(side.attentionItem?.id).toBe("run-fail");
  });
});
