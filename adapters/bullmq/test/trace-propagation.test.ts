import { describe, expect, it } from "vitest";
import {
  BULLMQ_TRACE_CARRIER_KEY,
  NO_OP_INSTRUMENTATION,
  OSVA_SPAN,
  extractBullMqTraceCarrier,
  withBullMqTraceCarrier,
  type OsvaInstrumentation,
  type TraceContextCarrier,
} from "@osva/observability";

import { parseExecutionJobPayload } from "../src/payload.js";

describe("BullMQ trace carrier transport", () => {
  it("preserves RunAttempt identity separately from trace metadata", () => {
    const payload = withBullMqTraceCarrier(
      { runAttemptId: "attempt-1" },
      { traceparent: "00-abc-def-01" },
    );

    expect(parseExecutionJobPayload(payload)).toEqual({
      runAttemptId: "attempt-1",
    });
    expect(extractBullMqTraceCarrier(payload)?.traceparent).toBe(
      "00-abc-def-01",
    );
    expect(payload[BULLMQ_TRACE_CARRIER_KEY]).toEqual({
      traceparent: "00-abc-def-01",
    });
  });

  it("extracts injected context for worker continuation", async () => {
    let capturedCarrier: TraceContextCarrier | undefined;
    const instrumentation: OsvaInstrumentation = {
      ...NO_OP_INSTRUMENTATION,
      injectTraceContext() {
        return { traceparent: "00-producer-span-01" };
      },
      async runWithExtractedContext(carrier, fn) {
        capturedCarrier = carrier;
        return fn();
      },
    };

    const payload = withBullMqTraceCarrier(
      { runAttemptId: "attempt-2" },
      instrumentation.injectTraceContext(),
    );

    await instrumentation.runWithExtractedContext(
      extractBullMqTraceCarrier(payload),
      async () =>
        instrumentation.withSpan(
          OSVA_SPAN.RUN_ATTEMPT_EXECUTE,
          {},
          async () => undefined,
        ),
    );

    expect(capturedCarrier?.traceparent).toBe("00-producer-span-01");
  });
});
