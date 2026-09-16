import { createWorkflowOrchestratorProcess } from "./process.js";
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
  const orchestrator = createWorkflowOrchestratorProcess();
  try {
    await orchestrator.start();
    await waitForShutdownSignal();
  } finally {
    await orchestrator.stop();
  }
}

try {
  await main();
} catch (error) {
  logError("workflow_orchestrator.startup_failed", error);
  process.exitCode = 1;
}
