import { OsvaClient } from "@osva-ai/sdk";

import { HelloConfigurationError, loadHelloEnv } from "./lib/env.js";
import { printFailure } from "./lib/output.js";

function parseRunId(argv: readonly string[]): string | undefined {
  const positional = argv.find((arg) => !arg.startsWith("-"));
  return positional?.trim();
}

async function main(): Promise<void> {
  const runId = parseRunId(process.argv.slice(2));
  if (runId === undefined || runId.length === 0) {
    printFailure(
      "Usage: pnpm --filter @osva/example-hello-agent run status -- <runId>",
    );
    process.exitCode = 1;
    return;
  }

  let env;
  try {
    env = loadHelloEnv();
  } catch (error) {
    if (error instanceof HelloConfigurationError) {
      printFailure(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const client = new OsvaClient({
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
    timeoutMs: env.runPollTimeoutMs,
  });

  const run = await client.runs.get(runId as never);
  const attempts = await client.runs.listAttempts(runId as never);
  const latestAttempt = [...attempts.attempts].sort(
    (left, right) => right.sequence - left.sequence,
  )[0];

  console.log(JSON.stringify({ run, latestAttempt }, null, 2));
}

main().catch((error: unknown) => {
  printFailure(error instanceof Error ? error.message : "hello:status failed.");
  process.exitCode = 1;
});
