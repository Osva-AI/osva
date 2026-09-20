import { createKnowledgeWorkerProcess } from "./process.js";
import { logEvent } from "./log.js";

function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    const onSignal = () => {
      process.off("SIGTERM", onSignal);
      process.off("SIGINT", onSignal);
      resolve();
    };
    process.once("SIGTERM", onSignal);
    process.once("SIGINT", onSignal);
  });
}

async function main(): Promise<void> {
  const worker = createKnowledgeWorkerProcess();
  try {
    await worker.start();
    await waitForShutdownSignal();
  } finally {
    await worker.stop();
  }
}

try {
  await main();
} catch (error) {
  logEvent("knowledge_worker.startup_failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
}
