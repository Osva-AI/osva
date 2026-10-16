import { OsvaClient } from "@osva-ai/sdk";

import type { CliConfig } from "../config.js";
import { validateExitCode } from "../validate/exit-code.js";
import { formatValidateHuman, formatValidateJson } from "../validate/format.js";
import { resolveValidateProjectDir } from "../validate/resolve-project-dir.js";
import { runValidatePipeline } from "../validate/run-validate.js";
import { loadProjectDeployEnv } from "./deploy-env.js";
import { ensureAgentVersion } from "./ensure-agent-version.js";
import { ProjectConfigurationError, ProjectDeployError } from "./errors.js";
import type { DeployResultPayload } from "./format.js";
import { installTrustedRuntimeArtifact } from "./install-trusted-runtime.js";
import { loadProjectManifest } from "./load-manifest.js";
import { resolveAuthenticatedWorkspace } from "./workspace-context.js";

export async function runDeployPipeline(input: {
  readonly config: CliConfig;
  readonly flags: Readonly<Record<string, string | boolean>>;
  readonly cwd?: string;
}): Promise<
  | { ok: true; payload: DeployResultPayload }
  | { ok: false; exitCode: number; message?: string; validateStdout?: string }
> {
  const cwd = input.cwd ?? process.cwd();
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
          : "Invalid deploy configuration.",
    };
  }

  const manifest = await loadProjectManifest(resolved.projectDir);
  const runtime = manifest.runtime;
  if (runtime.type !== "TRUSTED_TYPESCRIPT") {
    return {
      ok: false,
      exitCode: 1,
      message: "Only TRUSTED_TYPESCRIPT agents can be deployed.",
    };
  }

  if (runtime.integrity.trim().length === 0) {
    return {
      ok: false,
      exitCode: 1,
      message: "Manifest runtime.integrity is missing.",
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

  let installed;
  try {
    installed = await installTrustedRuntimeArtifact({
      projectDir: resolved.projectDir,
      manifest,
      deployEnv,
    });
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      message:
        error instanceof ProjectDeployError
          ? error.message
          : "Trusted runtime install failed.",
    };
  }

  if (installed.integrity !== runtime.integrity) {
    return {
      ok: false,
      exitCode: 1,
      message:
        "Installed executable digest does not match manifest runtime.integrity.",
    };
  }

  let registration;
  try {
    registration = await ensureAgentVersion({
      client,
      projectDir: resolved.projectDir,
      baseUrl: input.config.baseUrl,
      workspaceId,
      manifest,
      integrity: installed.integrity,
      deployTarget: installed.deployTarget,
      entrypoint: installed.entrypoint,
    });
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      message:
        error instanceof Error
          ? error.message
          : "Failed to register AgentVersion.",
    };
  }

  return {
    ok: true,
    payload: {
      agentId: registration.agentId,
      agentVersionId: registration.agentVersionId,
      deployTarget: installed.deployTarget,
      integrity: installed.integrity,
      reusedAgentVersion: registration.reused,
      workspaceId,
    },
  };
}
