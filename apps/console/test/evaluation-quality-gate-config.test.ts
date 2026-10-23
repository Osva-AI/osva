import { describe, expect, it } from "vitest";

import {
  buildQualityGatePolicyFromDrafts,
  parseDisplayThresholdToCanonical,
  parsePercentToUnitRate,
  parseUsdToCostMicros,
  validateQualityGateRuleDrafts,
} from "../src/client/lib/evaluation-quality-gate-config";

describe("evaluation quality gate config", () => {
  it("builds no policy when gates are disabled", () => {
    expect(
      validateQualityGateRuleDrafts(false, [
        {
          localId: "1",
          metric: "PASS_RATE",
          thresholdDisplay: "80",
        },
      ]),
    ).toEqual([]);
  });

  it("accepts a valid gate policy for launch", () => {
    const issues = validateQualityGateRuleDrafts(true, [
      {
        localId: "1",
        metric: "PASS_RATE",
        thresholdDisplay: "80",
      },
      {
        localId: "2",
        metric: "ERROR_COUNT",
        thresholdDisplay: "0",
      },
    ]);
    expect(issues).toEqual([]);
    const policy = buildQualityGatePolicyFromDrafts([
      {
        localId: "1",
        metric: "PASS_RATE",
        thresholdDisplay: "80",
      },
      {
        localId: "2",
        metric: "ERROR_COUNT",
        thresholdDisplay: "0",
      },
    ]);
    expect(policy?.rules).toEqual([
      { metric: "PASS_RATE", operator: "MIN", threshold: 0.8 },
      { metric: "ERROR_COUNT", operator: "MAX", threshold: 0 },
    ]);
  });

  it("rejects invalid thresholds", () => {
    const issues = validateQualityGateRuleDrafts(true, [
      {
        localId: "1",
        metric: "PASS_RATE",
        thresholdDisplay: "150",
      },
    ]);
    expect(issues.some((issue) => issue.field === "threshold")).toBe(true);
  });

  it("rejects duplicate metrics", () => {
    const issues = validateQualityGateRuleDrafts(true, [
      {
        localId: "1",
        metric: "PASS_RATE",
        thresholdDisplay: "50",
      },
      {
        localId: "2",
        metric: "PASS_RATE",
        thresholdDisplay: "60",
      },
    ]);
    expect(
      issues.some(
        (issue) => issue.field === "metric" && issue.message.includes("once"),
      ),
    ).toBe(true);
  });

  it("converts percentage display to canonical unit rates", () => {
    expect(parsePercentToUnitRate("80")).toBe(0.8);
    expect(parseDisplayThresholdToCanonical("QUALITY_SCORE", "100")).toBe(1);
    expect(parseDisplayThresholdToCanonical("PASS_RATE", "0")).toBe(0);
  });

  it("converts USD display to cost micros", () => {
    expect(parseUsdToCostMicros("1.25")).toBe(1_250_000);
    expect(
      parseDisplayThresholdToCanonical("ESTIMATED_COST_USD_MICROS", "0.5"),
    ).toBe(500_000);
  });
});
