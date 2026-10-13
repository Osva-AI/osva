import { describe, expect, it } from "vitest";

import { isForbiddenMetricLabel } from "../src/attributes.js";
import {
  NO_OP_INSTRUMENTATION,
  assertSafeMetricAttributes,
} from "../src/instrumentation.js";
import { RecordingInstrumentation } from "../src/recording-instrumentation.js";

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
    NO_OP_INSTRUMENTATION.recordGauge("osva.queue.jobs", 3, {
      queue: "execution",
      state: "waiting",
    });
  });

  it("rejects high-cardinality metric labels including alternate forms", () => {
    expect(() =>
      assertSafeMetricAttributes({ "osva.run.id": "run-1" }),
    ).toThrow(/high-cardinality/);
    expect(() => assertSafeMetricAttributes({ runId: "run-1" })).toThrow(
      /high-cardinality/,
    );
    expect(() => assertSafeMetricAttributes({ workflowRunId: "wf-1" })).toThrow(
      /high-cardinality/,
    );
    expect(() =>
      assertSafeMetricAttributes({ "osva.workflow_node_run.id": "node-1" }),
    ).toThrow(/high-cardinality/);
    expect(() => assertSafeMetricAttributes({ requestId: "req-1" })).toThrow(
      /high-cardinality/,
    );
    expect(() => assertSafeMetricAttributes({ subjectId: "sub-1" })).toThrow(
      /high-cardinality/,
    );
    expect(() => assertSafeMetricAttributes({ userId: "user-1" })).toThrow(
      /high-cardinality/,
    );
    expect(() => assertSafeMetricAttributes({ traceId: "abc" })).toThrow(
      /high-cardinality/,
    );
    expect(() =>
      assertSafeMetricAttributes({ executionOwner: "worker:1" }),
    ).toThrow(/high-cardinality/);
    expect(() =>
      assertSafeMetricAttributes({ "OSVA.RUN.ID": "run-1" }),
    ).toThrow(/high-cardinality/);
    expect(() =>
      assertSafeMetricAttributes({ provider: "OPENAI" }),
    ).not.toThrow();
    expect(isForbiddenMetricLabel("run_attempt_id")).toBe(true);
    expect(isForbiddenMetricLabel("osva.request.id")).toBe(true);
  });

  it("rejects unsafe labels without recording their values", () => {
    const telemetry = new RecordingInstrumentation();
    expect(() =>
      telemetry.recordCounter("osva.http.requests", 1, {
        runId: "secret-run-id",
      }),
    ).toThrow(/high-cardinality/);
    expect(JSON.stringify(telemetry.metrics)).not.toContain("secret-run-id");
  });
});
