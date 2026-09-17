import { describe, expect, it } from "vitest";

import { BULLMQ_JOB_ID_PREFIX } from "../src/constants.js";
import { toBullMqJobId } from "../src/job-id.js";
import { parseExecutionJobPayload } from "../src/payload.js";
import { InvalidQueuePayloadError } from "../src/errors.js";

describe("toBullMqJobId", () => {
  it("uses the conceptual run-attempt prefix for safe RunAttempt IDs", () => {
    expect(toBullMqJobId("run-attempt-1")).toBe(
      `${BULLMQ_JOB_ID_PREFIX}run-attempt-1`,
    );
    expect(toBullMqJobId("550e8400-e29b-41d4-a716-446655440000")).toBe(
      `${BULLMQ_JOB_ID_PREFIX}550e8400-e29b-41d4-a716-446655440000`,
    );
  });

  it("encodes characters BullMQ forbids in custom IDs without changing OSVA IDs", () => {
    expect(toBullMqJobId("attempt:one")).toBe(
      `${BULLMQ_JOB_ID_PREFIX}attempt_3Aone`,
    );
  });
});

describe("parseExecutionJobPayload", () => {
  it("accepts { runAttemptId } and transport-only trace metadata", () => {
    expect(parseExecutionJobPayload({ runAttemptId: "attempt-1" })).toEqual({
      runAttemptId: "attempt-1",
    });
    expect(
      parseExecutionJobPayload({
        runAttemptId: "attempt-1",
        __osvaTraceCarrier: { traceparent: "00-abc-def-01" },
      }),
    ).toEqual({ runAttemptId: "attempt-1" });
  });

  it("rejects extra execution data", () => {
    expect(() =>
      parseExecutionJobPayload({
        runAttemptId: "attempt-1",
        input: { prompt: "no" },
      }),
    ).toThrow(InvalidQueuePayloadError);
  });
});
