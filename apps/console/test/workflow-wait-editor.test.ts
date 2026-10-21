import { describe, expect, it } from "vitest";

import {
  durationMsToMinutes,
  minutesToDurationMs,
  utcIsoFromLocalDatetimeInput,
} from "../src/client/lib/workflow-wait-editor";

describe("workflow wait editor serialization", () => {
  it("converts minutes and durationMs", () => {
    expect(durationMsToMinutes(120_000)).toBe(2);
    expect(minutesToDurationMs(5)).toBe(300_000);
  });

  it("parses datetime-local values to UTC ISO", () => {
    const iso = utcIsoFromLocalDatetimeInput("2026-06-01T10:30");
    expect(iso).toMatch(/2026-06-01T/);
    expect(iso).toMatch(/Z$/);
  });
});
