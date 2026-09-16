import {
  BullMqJobQueue,
  EXECUTE_RUN_ATTEMPT_JOB_NAME,
  toBullMqJobId,
} from "../dist/index.js";

const url = process.env.OSVA_VALKEY_URL?.trim() ?? "";
if (url.length === 0) {
  throw new Error("OSVA_VALKEY_URL is required.");
}

const runAttemptId = "compose-smoke-attempt";
const queue = new BullMqJobQueue({ url });

try {
  await queue.enqueue(runAttemptId);
  const job = await queue.getQueuedJob(runAttemptId);
  if (
    job === null ||
    job.name !== EXECUTE_RUN_ATTEMPT_JOB_NAME ||
    job.id !== toBullMqJobId(runAttemptId) ||
    JSON.stringify(job.data) !== JSON.stringify({ runAttemptId })
  ) {
    throw new Error(
      "Compose smoke failed to enqueue an execution job into Valkey.",
    );
  }
  console.log("BullMQ enqueue against Compose Valkey succeeded");
} finally {
  await queue.shutdown();
}
