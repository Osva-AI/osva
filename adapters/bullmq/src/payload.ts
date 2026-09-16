import type { JobQueuePayload } from "@osva/contracts";
import { jobQueuePayloadSchema } from "@osva/contracts/schemas";

import { InvalidQueuePayloadError } from "./errors.js";

export function parseExecutionJobPayload(data: unknown): JobQueuePayload {
  const parsed = jobQueuePayloadSchema.safeParse(data);
  if (!parsed.success) {
    throw new InvalidQueuePayloadError();
  }

  return Object.freeze({ runAttemptId: parsed.data.runAttemptId });
}
