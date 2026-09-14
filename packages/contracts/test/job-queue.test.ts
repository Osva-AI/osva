import { describe, expect, it } from "vitest";

import { jobQueuePayloadSchema } from "../src/schemas/job-queue.js";

describe("JobQueue payload", () => {
  it("accepts only the documented payload shape", () => {
    const parsed = jobQueuePayloadSchema.parse({
      runAttemptId: "attempt-1",
    });
    expect(parsed).toEqual({ runAttemptId: "attempt-1" });
  });

  it("rejects missing runAttemptId", () => {
    expect(jobQueuePayloadSchema.safeParse({}).success).toBe(false);
  });

  it("rejects extra queue-engine fields", () => {
    const parsed = jobQueuePayloadSchema.safeParse({
      runAttemptId: "attempt-1",
      jobId: "bullmq-job-1",
    });
    expect(parsed.success).toBe(false);
  });
});
