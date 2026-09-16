import { createSchedulerProcess } from "./process.js";
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
  const scheduler = createSchedulerProcess();
  try {
    await scheduler.start();
    await waitForShutdownSignal();
  } finally {
    await scheduler.stop();
  }
}

try {
  await main();
} catch (error) {
  logError("scheduler.startup_failed", error);
  process.exitCode = 1;
}
