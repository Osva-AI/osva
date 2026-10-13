import { describe, expect, it } from "vitest";

import {
  extractBullMqTraceCarrier,
  withBullMqTraceCarrier,
} from "../src/trace-carrier.js";
import { OSVA_SPAN } from "../src/span-names.js";
import { RecordingInstrumentation } from "../src/recording-instrumentation.js";

describe("trace correlation across enqueue and consume", () => {
  it("makes queue processing a child of the propagated web/create-run context", async () => {
    const telemetry = new RecordingInstrumentation();

    await telemetry.withSpan(OSVA_SPAN.HTTP_REQUEST, {}, async () => {
      await telemetry.withSpan(OSVA_SPAN.RUN_CREATE, {}, async () => {
        const payload = withBullMqTraceCarrier(
          { runAttemptId: "attempt-1" },
          telemetry.injectTraceContext(),
        );

        await telemetry.runWithExtractedContext(
          extractBullMqTraceCarrier(payload),
          async () => {
            await telemetry.withSpan(OSVA_SPAN.QUEUE_PROCESS, {}, async () => {
              await telemetry.withSpan(
                OSVA_SPAN.RUN_ATTEMPT_EXECUTE,
                {},
                async () => undefined,
              );
            });
          },
        );
      });
    });

    const http = telemetry.spans.find(
      (span) => span.name === OSVA_SPAN.HTTP_REQUEST,
    );
    const create = telemetry.spans.find(
      (span) => span.name === OSVA_SPAN.RUN_CREATE,
    );
    const queue = telemetry.spans.find(
      (span) => span.name === OSVA_SPAN.QUEUE_PROCESS,
    );
    const execute = telemetry.spans.find(
      (span) => span.name === OSVA_SPAN.RUN_ATTEMPT_EXECUTE,
    );

    expect(http).toBeDefined();
    expect(create?.parentSpanId).toBe(http?.spanId);
    expect(create?.traceId).toBe(http?.traceId);
    expect(queue?.traceId).toBe(http?.traceId);
    expect(queue?.parentSpanId).toBe(create?.spanId);
    expect(execute?.parentSpanId).toBe(queue?.spanId);
    expect(execute?.traceId).toBe(http?.traceId);
  });

  it("starts a root queue trace when no upstream context exists", async () => {
    const telemetry = new RecordingInstrumentation();

    await telemetry.runWithExtractedContext(undefined, async () => {
      await telemetry.withSpan(
        OSVA_SPAN.QUEUE_PROCESS,
        {},
        async () => undefined,
      );
    });

    const queue = telemetry.spans.find(
      (span) => span.name === OSVA_SPAN.QUEUE_PROCESS,
    );
    expect(queue?.parentSpanId).toBeUndefined();
    expect(queue?.traceId).toMatch(/^[0-9a-f]+$/);
  });
});
