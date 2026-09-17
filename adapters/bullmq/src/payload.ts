import type { JobQueuePayload } from "@osva/contracts";
import { jobQueuePayloadSchema } from "@osva/contracts/schemas";
import { BULLMQ_TRACE_CARRIER_KEY } from "@osva/observability";

import { InvalidQueuePayloadError } from "./errors.js";

export function parseExecutionJobPayload(data: unknown): JobQueuePayload {
  if (data === null || typeof data !== "object") {
    throw new InvalidQueuePayloadError();
  }

  const candidate = data as Record<string, unknown>;
  for (const key of Object.keys(candidate)) {
    if (key !== "runAttemptId" && key !== BULLMQ_TRACE_CARRIER_KEY) {
      throw new InvalidQueuePayloadError();
    }
  }

  const parsed = jobQueuePayloadSchema.safeParse({
    runAttemptId: candidate.runAttemptId,
  });
  if (!parsed.success) {
    throw new InvalidQueuePayloadError();
  }

  return Object.freeze({ runAttemptId: parsed.data.runAttemptId });
}
