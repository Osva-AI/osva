import { createWebProcess } from "./process.js";
import { logError } from "./log.js";

async function main(): Promise<void> {
  const web = createWebProcess();

  const onSignal = () => {
    void web.stop().catch((error: unknown) => {
      logError("web.shutdown_failed", error);
      process.exitCode = 1;
    });
  };

  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);

  try {
    await web.listen();
  } catch (error) {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
    await web.stop();
    throw error;
  }
}

try {
  await main();
} catch (error) {
  logError("web.startup_failed", error);
  process.exitCode = 1;
}
