import { OsvaClient } from "@osva-ai/sdk";

import type { CliConfig } from "../config.js";
import { validateExitCode } from "../validate/exit-code.js";
import { formatValidateHuman, formatValidateJson } from "../validate/format.js";
import { resolveValidateProjectDir } from "../validate/resolve-project-dir.js";
import { runValidatePipeline } from "../validate/run-validate.js";
import { loadProjectDeployEnv } from "./deploy-env.js";
import { ProjectConfigurationError, ProjectStateError } from "./errors.js";
import type { RunResultPayload } from "./format.js";
import { loadProjectManifest } from "./load-manifest.js";
import { manifestFingerprint } from "./manifest.js";
import { parseRunInput } from "./parse-run-input.js";
import { pollUntilReady, ProjectPollError } from "./poll.js";
import {
  assertDeploymentContext,
  readDeploymentState,
  writeDeploymentState,
} from "./state.js";
import { resolveAuthenticatedWorkspace } from "./workspace-context.js";

const TERMINAL_RUN_STATUSES = new Set([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
]);

export async function runRunPipeline(input: {
  readonly config: CliConfig;
  readonly flags: Readonly<Record<string, string | boolean>>;
  readonly cwd?: string;
}): Promise<
  | { ok: true; payload: RunResultPayload; waited: boolean }
  | { ok: false; exitCode: number; message?: string; validateStdout?: string }
> {
  const cwd = input.cwd ?? process.cwd();
  const wait = input.flags.wait === true;
  const resolved = await resolveValidateProjectDir({ cwd, flags: input.flags });
  if (!resolved.ok) {
    return {
      ok: false,
      exitCode: 1,
      message: resolved.error,
    };
  }

  const validateReport = await runValidatePipeline(resolved.projectDir);
  const validateExit = validateExitCode(validateReport);
  if (validateExit !== 0) {
    const json = input.config.json;
    return {
      ok: false,
      exitCode: validateExit,
      validateStdout: json
        ? formatValidateJson(validateReport)
        : formatValidateHuman(validateReport),
    };
  }

  let deployEnv;
  try {
    deployEnv = loadProjectDeployEnv();
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      message:
        error instanceof ProjectConfigurationError
          ? error.message
          : "Invalid configuration.",
    };
  }

  const manifest = await loadProjectManifest(resolved.projectDir);
  const runtime = manifest.runtime;
  if (runtime.type !== "TRUSTED_TYPESCRIPT") {
    return { ok: false, exitCode: 1, message: "Invalid manifest runtime." };
  }

  const fingerprint = manifestFingerprint(manifest);
  const state = await readDeploymentState(resolved.projectDir);
  if (state === null) {
    return {
      ok: false,
      exitCode: 1,
      message: "No deployment found. Run osva deploy before osva run.",
    };
  }

  let runInput;
  try {
    runInput = await parseRunInput({
      projectDir: resolved.projectDir,
      flags: input.flags,
    });
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      message:
        error instanceof ProjectConfigurationError
          ? error.message
          : "Invalid run input.",
    };
  }

  const client = new OsvaClient({
    baseUrl: input.config.baseUrl,
    apiKey: input.config.apiKey,
    timeoutMs: deployEnv.runPollTimeoutMs,
  });

  let workspaceId: string;
  try {
    workspaceId = await resolveAuthenticatedWorkspace({
      client,
      configuredWorkspaceId: process.env.OSVA_WORKSPACE_ID,
    });
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      message:
        error instanceof ProjectConfigurationError
          ? error.message
          : "Could not resolve workspace.",
    };
  }

  try {
    assertDeploymentContext({
      state,
      baseUrl: input.config.baseUrl,
      workspaceId,
      manifestFingerprint: fingerprint,
      integrity: runtime.integrity,
    });
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      message:
        error instanceof ProjectStateError
          ? error.message
          : "Deployment state is stale.",
    };
  }

  const created = await client.runs.create({
    agentId: state.agentId as never,
    agentVersionId: state.agentVersionId as never,
    input: runInput,
  });

  let runStatus = created.run.status;
  let attemptStatus = created.runAttempt.status;
  let output: unknown = created.runAttempt.output ?? null;

  if (wait) {
    let terminalRun;
    try {
      terminalRun = await pollUntilReady({
        label: "Agent Run",
        intervalMs: deployEnv.runPollIntervalMs,
        timeoutMs: deployEnv.runPollTimeoutMs,
        fetch: () => client.runs.get(created.run.id),
        getStatus: (run) => run.status,
        isReady: (run) => run.status === "SUCCEEDED",
        isFailed: (run) =>
          run.status === "FAILED" ||
          run.status === "CANCELLED" ||
          run.status === "TIMED_OUT",
      });
    } catch (error) {
      return {
        ok: false,
        exitCode: 1,
        message:
          error instanceof ProjectPollError
            ? error.message
            : "Run polling failed.",
      };
    }

    runStatus = terminalRun.status;
    const attempt = await client.runs.getAttempt(
      created.run.id,
      created.runAttempt.id,
    );
    attemptStatus = attempt.status;
    output = attempt.output ?? null;

    if (!TERMINAL_RUN_STATUSES.has(runStatus)) {
      return {
        ok: false,
        exitCode: 1,
        message: `Run ended in unexpected status '${runStatus}'.`,
      };
    }

    if (runStatus === "SUCCEEDED" && attemptStatus !== "SUCCEEDED") {
      return {
        ok: false,
        exitCode: 1,
        message: `Run reached ${runStatus} but RunAttempt status is ${attemptStatus}.`,
      };
    }

    if (runStatus !== "SUCCEEDED") {
      return {
        ok: false,
        exitCode: 1,
        message: `Run finished with status ${runStatus} (RunAttempt: ${attemptStatus}).`,
      };
    }
  }

  await writeDeploymentState(resolved.projectDir, {
    ...state,
    updatedAt: new Date().toISOString(),
    lastRunId: created.run.id,
    lastRunAttemptId: created.runAttempt.id,
  });

  return {
    ok: true,
    waited: wait,
    payload: {
      runId: created.run.id,
      runAttemptId: created.runAttempt.id,
      agentId: state.agentId,
      agentVersionId: state.agentVersionId,
      status: runStatus,
      runAttemptStatus: attemptStatus,
      output,
    },
  };
}
