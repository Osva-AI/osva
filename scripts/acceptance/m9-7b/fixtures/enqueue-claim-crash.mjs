import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const runAttemptId = process.argv[2];
const valkeyUrl = process.argv[3];
if (!runAttemptId || !valkeyUrl) {
  console.error("Usage: enqueue-claim-crash.mjs <runAttemptId> <valkeyUrl>");
  process.exit(2);
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const modulePath = path.join(
  repoRoot,
  "adapters/bullmq/dist/bullmq-job-queue.js",
);
const { BullMqJobQueue } = await import(pathToFileURL(modulePath).href);

let releaseGate;
const gate = new Promise((resolve) => {
  releaseGate = resolve;
});

process.on("message", (message) => {
  if (message === "release") {
    releaseGate?.();
  }
});

const queue = new BullMqJobQueue({
  url: valkeyUrl,
  enqueueClaimTestHooks: {
    afterClaimBeforeAdd: async () => {
      process.stdout.write("CLAIM_HELD\n");
      await gate;
    },
  },
});

try {
  await queue.enqueue(runAttemptId);
  process.stdout.write("ENQUEUE_COMPLETE\n");
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await queue.shutdown();
}
