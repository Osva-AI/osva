import { describe, expect, it } from "vitest";

import {
  buildAgentRunHistoryRows,
  buildWorkflowRunHistoryRows,
} from "../src/client/lib/execution-history-feed";

describe("execution-history-feed", () => {
  it("builds agent rows with context labels and detail links", () => {
    const rows = buildAgentRunHistoryRows([
      {
        id: "run-abcdefghijklmnop",
        agentId: "agent-1234567890",
        status: "RUNNING",
        effectiveBindings: {
          agentVersionId: "version-1234567890",
          modelProfileVersionBindings: {},
          toolVersionBindings: {},
        },
        input: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.href).toBe("/runs/run-abcdefghijklmnop");
    expect(rows[0]?.shortId).toMatch(/…/);
    expect(rows[0]?.contextLabel).toContain("Agent");
    expect(rows[0]?.statusLabel).toBe("Running");
  });

  it("marks workflow waiting rows", () => {
    const rows = buildWorkflowRunHistoryRows([
      {
        id: "wr-wait",
        workspaceId: "ws-1",
        workflowId: "wf-1",
        workflowVersionId: "wv-1",
        status: "WAITING",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
      },
    ]);
    expect(rows[0]?.isWaiting).toBe(true);
    expect(rows[0]?.statusLabel).toBe("Waiting");
  });
});
