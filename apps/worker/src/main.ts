import { createWorkerProcess } from "./process.js";
import { logError } from "./log.js";

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
  const worker = createWorkerProcess();
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
  logError("worker.startup_failed", error);
  process.exitCode = 1;
}
