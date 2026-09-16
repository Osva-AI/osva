import { BULLMQ_JOB_ID_PREFIX } from "./constants.js";

const BULLMQ_SAFE_JOB_ID = /^[A-Za-z0-9._-]+$/;

/**
 * Internal BullMQ custom job ID. Not an OSVA identity.
 * BullMQ forbids ':' in custom IDs; other RunAttempt ID characters are
 * percent-encoded only when the raw id would be unsafe.
 */
export function toBullMqJobId(runAttemptId: string): string {
  const encoded = BULLMQ_SAFE_JOB_ID.test(runAttemptId)
    ? runAttemptId
    : encodeURIComponent(runAttemptId).replaceAll("%3A", "_3A");
  return `${BULLMQ_JOB_ID_PREFIX}${encoded}`;
}
