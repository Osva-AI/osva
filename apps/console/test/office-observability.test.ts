import { describe, expect, it } from "vitest";

import {
  mapOfficeObservabilityAssignments,
  formatTerminalSuccessRatePercent,
} from "../src/client/lib/office-observability";
import type { OfficeAssignmentResource } from "../src/client/hooks/use-office";
import type { WorkspaceId } from "@osva-ai/contracts";
import { summarizeTaskExecution } from "@osva/domain/office-observability";

describe("office observability console adapter", () => {
  it("maps assignment API rows for domain aggregation", () => {
    const row: OfficeAssignmentResource = {
      id: "a1",
      workspaceId: "ws-1",
      officeWorkerId: "ow-1",
      title: "Task",
      targetType: "AGENT_VERSION",
      targetVersionId: "av-1",
      input: {},
      status: "COMPLETED",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z",
    };
    const records = mapOfficeObservabilityAssignments([row]);
    const summary = summarizeTaskExecution(records, "ws-1" as WorkspaceId);
    expect(summary.completed).toBe(1);
    expect(summary.duration.measuredCount).toBe(1);
  });

  it("formats terminal success rate for display", () => {
    expect(
      formatTerminalSuccessRatePercent({
        terminalSuccessRate: null,
        terminalDenominator: 0,
      }),
    ).toBe("—");
    expect(
      formatTerminalSuccessRatePercent({
        terminalSuccessRate: 0.667,
        terminalDenominator: 3,
      }),
    ).toBe("67%");
  });
});
