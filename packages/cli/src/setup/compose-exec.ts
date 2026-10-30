import path from "node:path";

import { redactSecrets } from "../doctor/redact.js";
import {
  defaultProbeSpawn,
  type ProbeSpawnFn,
  type ProbeSpawnResult,
} from "./probe-spawn.js";

export interface ComposeExecContext {
  readonly installDir: string;
  readonly envFilePath: string;
  readonly projectName: string;
}

export interface ComposeExecOptions {
  readonly spawn?: ProbeSpawnFn;
  readonly timeoutMs: number;
  readonly processEnv?: NodeJS.ProcessEnv;
}

export function buildComposeSpawnEnv(
  ctx: ComposeExecContext,
  processEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...processEnv,
    COMPOSE_PROJECT_NAME: ctx.projectName,
  };
}

export function composeBaseArgs(ctx: ComposeExecContext): string[] {
  return [
    "compose",
    "--project-name",
    ctx.projectName,
    "--project-directory",
    ctx.installDir,
    "--env-file",
    ctx.envFilePath,
    "-f",
    path.join(ctx.installDir, "compose.yml"),
  ];
}

export function runComposeCommand(
  ctx: ComposeExecContext,
  args: readonly string[],
  options: ComposeExecOptions,
): ProbeSpawnResult {
  const spawn = options.spawn ?? defaultProbeSpawn;
  const dockerArgs = [...composeBaseArgs(ctx), ...args];
  const processEnv =
    options.processEnv ?? buildComposeSpawnEnv(ctx, process.env);
  return spawn("docker", dockerArgs, options.timeoutMs, processEnv);
}

export function assertComposeSuccess(
  result: ProbeSpawnResult,
  action: string,
): void {
  if (result.error?.code === "ETIMEDOUT") {
    throw new ComposeExecError(
      "timeout",
      `${action} timed out. Retry when Docker responds promptly.`,
    );
  }
  if (result.status !== 0) {
    const detail = redactSecrets(
      firstLine(result.stderr) || firstLine(result.stdout),
    );
    throw new ComposeExecError(
      "command_failed",
      detail.length > 0 ? `${action} failed: ${detail}` : `${action} failed.`,
    );
  }
}

export function composeCommandIncludesDestructiveVolumeRemoval(
  args: readonly string[],
): boolean {
  const joined = args.join(" ");
  return /\bdown\b/.test(joined) && /(?:^|\s)-v(?:\s|$)/.test(joined);
}

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}

export class ComposeExecError extends Error {
  readonly code: "timeout" | "command_failed";

  constructor(code: "timeout" | "command_failed", message: string) {
    super(message);
    this.code = code;
  }
}
