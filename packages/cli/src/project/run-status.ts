import { OsvaClient } from "@osva-ai/sdk";

import type { CliConfig } from "../config.js";
import { resolveValidateProjectDir } from "../validate/resolve-project-dir.js";
import { loadProjectDeployEnv } from "./deploy-env.js";
import { ProjectConfigurationError, ProjectStateError } from "./errors.js";
import type { StatusResultPayload } from "./format.js";
import { loadProjectManifest } from "./load-manifest.js";
import { manifestFingerprint } from "./manifest.js";
import { assertDeploymentContext, readDeploymentState } from "./state.js";
import { resolveAuthenticatedWorkspace } from "./workspace-context.js";

export async function runStatusPipeline(input: {
  readonly config: CliConfig;
  readonly flags: Readonly<Record<string, string | boolean>>;
  readonly cwd?: string;
}): Promise<
  | { ok: true; payload: StatusResultPayload }
  | { ok: false; exitCode: number; message: string }
> {
  const cwd = input.cwd ?? process.cwd();
  const resolved = await resolveValidateProjectDir({ cwd, flags: input.flags });
  if (!resolved.ok) {
    return { ok: false, exitCode: 1, message: resolved.error };
  }

  const state = await readDeploymentState(resolved.projectDir);
  if (state === null) {
    return {
      ok: true,
      payload: { deployment: null },
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
    const manifest = await loadProjectManifest(resolved.projectDir);
    const runtime = manifest.runtime;
    if (runtime.type !== "TRUSTED_TYPESCRIPT") {
      return { ok: false, exitCode: 1, message: "Invalid manifest runtime." };
    }
    assertDeploymentContext({
      state,
      baseUrl: input.config.baseUrl,
      workspaceId,
      manifestFingerprint: manifestFingerprint(manifest),
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

  let lastRun: StatusResultPayload["lastRun"];
  if (state.lastRunId !== undefined) {
    try {
      const run = await client.runs.get(state.lastRunId as never);
      let runAttemptStatus: string | undefined;
      if (state.lastRunAttemptId !== undefined) {
        const attempt = await client.runs.getAttempt(
          state.lastRunId as never,
          state.lastRunAttemptId as never,
        );
        runAttemptStatus = attempt.status;
      }
      lastRun = {
        id: run.id,
        status: run.status,
        ...(state.lastRunAttemptId === undefined
          ? {}
          : { runAttemptId: state.lastRunAttemptId }),
        ...(runAttemptStatus === undefined ? {} : { runAttemptStatus }),
      };
    } catch {
      // Keep local deployment info even when the run is no longer visible.
    }
  }

  return {
    ok: true,
    payload: {
      deployment: {
        agentId: state.agentId,
        agentVersionId: state.agentVersionId,
        agentKey: state.agentKey,
        deployTarget: state.deployTarget,
        integrity: state.integrity,
        updatedAt: state.updatedAt,
        ...(state.lastRunId === undefined
          ? {}
          : { lastRunId: state.lastRunId }),
        ...(state.lastRunAttemptId === undefined
          ? {}
          : { lastRunAttemptId: state.lastRunAttemptId }),
      },
      ...(lastRun === undefined ? {} : { lastRun }),
    },
  };
}
