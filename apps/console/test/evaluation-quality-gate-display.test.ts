import { describe, expect, it } from "vitest";

import {
  formatQualityScore,
  formatSummaryDurationMs,
  qualityGateReasonLabel,
  shouldShowUnpricedCostWarning,
} from "../src/client/lib/evaluation-quality-gate-display";

describe("evaluation quality gate display", () => {
  it("does not show missing quality score as zero", () => {
    expect(formatQualityScore(undefined)).toBe("—");
  });

  it("does not show missing terminal duration as zero", () => {
    expect(
      formatSummaryDurationMs(
        undefined,
        "COMPLETED",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:05.000Z",
        "live",
      ),
    ).toBe("—");
  });

  it("explains indeterminate cost evidence", () => {
    expect(qualityGateReasonLabel("COST_INCONCLUSIVE_UNPRICED")).toContain(
      "unpriced",
    );
  });

  it("warns when priced usage has unpriced model calls", () => {
    expect(shouldShowUnpricedCostWarning(2, true)).toBe(true);
    expect(shouldShowUnpricedCostWarning(0, true)).toBe(false);
  });
});
