import { describe, expect, it } from "vitest";

import {
  NO_OP_INSTRUMENTATION,
  assertSafeMetricAttributes,
} from "../src/instrumentation.js";

describe("OsvaInstrumentation no-op", () => {
  it("runs product code without throwing when telemetry is disabled", async () => {
    const result = await NO_OP_INSTRUMENTATION.withSpan(
      "osva.run.create",
      { "osva.run.id": "run-1" },
      async () => "ok",
    );

    expect(result).toBe("ok");
    NO_OP_INSTRUMENTATION.recordCounter("osva.runs.started", 1);
    NO_OP_INSTRUMENTATION.recordHistogram("osva.run.duration_ms", 12, {
      terminal_status: "SUCCEEDED",
    });
  });

  it("rejects high-cardinality metric labels", () => {
    expect(() =>
      assertSafeMetricAttributes({ "osva.run.id": "run-1" }),
    ).toThrow(/high-cardinality/);
    expect(() =>
      assertSafeMetricAttributes({ provider: "OPENAI" }),
    ).not.toThrow();
  });
});
