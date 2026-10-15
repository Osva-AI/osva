import { OsvaClient } from "@osva-ai/sdk";

import { deployHelloAgentRuntime, HelloDeployError } from "./lib/deploy.js";
import { ensureHelloAgentVersion } from "./lib/ensure.js";
import { HelloConfigurationError, loadHelloEnv } from "./lib/env.js";
import { pollUntilReady, HelloPollError } from "./lib/poll.js";
import { printFailure, printSuccess } from "./lib/output.js";
import { assertControlPlaneReady } from "./lib/readiness.js";
import { HelloTimer } from "./lib/timing.js";
import { validateHelloOutput } from "./lib/validate-output.js";

async function main(): Promise<void> {
  const timer = new HelloTimer(1);

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

  try {
    await assertControlPlaneReady(env);
  } catch (error) {
    if (error instanceof HelloConfigurationError) {
      printFailure(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  timer.markEnvironmentReady();

  const client = new OsvaClient({
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
    timeoutMs: env.runPollTimeoutMs,
  });

  let deployed;
  try {
    deployed = await deployHelloAgentRuntime(env);
  } catch (error) {
    if (
      error instanceof HelloDeployError ||
      error instanceof HelloConfigurationError
    ) {
      printFailure(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  let registration;
  try {
    registration = await ensureHelloAgentVersion({
      client,
      workspaceId: env.workspaceId,
      integrity: deployed.integrity,
    });
  } catch (error) {
    printFailure(
      error instanceof Error
        ? error.message
        : "Failed to register Hello Agent version.",
    );
    process.exitCode = 1;
    return;
  }
  timer.markAgentRegistrationComplete();

  const created = await client.runs.create({
    agentId: registration.agentId,
    agentVersionId: registration.agentVersionId,
    input: { message: env.message },
  });
  timer.markRunSubmitted();

  let terminalRun;
  try {
    terminalRun = await pollUntilReady({
      label: "Hello Agent Run",
      intervalMs: env.runPollIntervalMs,
      timeoutMs: env.runPollTimeoutMs,
      fetch: () => client.runs.get(created.run.id),
      getStatus: (run) => run.status,
      isReady: (run) => run.status === "SUCCEEDED",
      isFailed: (run) =>
        run.status === "FAILED" ||
        run.status === "CANCELLED" ||
        run.status === "TIMED_OUT",
      onStatus: (status) => {
        console.log(`Run status: ${status}`);
      },
    });
  } catch (error) {
    if (error instanceof HelloPollError) {
      printFailure(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  timer.markRunTerminal();

  const attempt = await client.runs.getAttempt(
    created.run.id,
    created.runAttempt.id,
  );

  if (attempt.status !== "SUCCEEDED") {
    printFailure(
      `Run reached ${terminalRun.status} but RunAttempt status is ${attempt.status}.`,
    );
    process.exitCode = 1;
    return;
  }

  const outputCheck = validateHelloOutput(attempt.output, env.message);
  if (!outputCheck.ok) {
    printFailure(outputCheck.message);
    process.exitCode = 1;
    return;
  }

  printSuccess({
    runId: created.run.id,
    runAttemptId: created.runAttempt.id,
    agentId: registration.agentId,
    agentVersionId: registration.agentVersionId,
    status: terminalRun.status,
    output: attempt.output ?? null,
    reusedAgentVersion: registration.reused,
    deployTarget: deployed.deployTarget,
    integrity: deployed.integrity,
    timing: timer.report(),
  });
}

main().catch((error: unknown) => {
  printFailure(error instanceof Error ? error.message : "hello:run failed.");
  process.exitCode = 1;
});
