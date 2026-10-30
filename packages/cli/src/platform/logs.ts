import {
  buildComposeSpawnEnv,
  composeBaseArgs,
  runComposeCommand,
} from "../setup/compose-exec.js";
import { redactSecrets } from "../doctor/redact.js";
import {
  defaultProbeSpawn,
  spawnStreamingCommand,
} from "../setup/probe-spawn.js";
import { KNOWN_COMPOSE_SERVICES } from "./services.js";
import { PlatformCommandError, type ResolvedInstallation } from "./types.js";

export const DEFAULT_LOG_TAIL = 100;
export const MAX_LOG_TAIL = 10_000;
export const COMPOSE_LOGS_TIMEOUT_MS = 120_000;

export interface PlatformLogsOptions {
  readonly service: string | undefined;
  readonly tail: number;
  readonly follow: boolean;
}

export function parsePlatformLogsOptions(
  flags: Readonly<Record<string, string | boolean>>,
): PlatformLogsOptions {
  const follow = flags.follow === true;
  const serviceFlag = flags.service;
  let service: string | undefined;
  if (typeof serviceFlag === "string" && serviceFlag.trim().length > 0) {
    service = serviceFlag.trim();
  } else if (serviceFlag === true) {
    throw new PlatformCommandError(
      "usage",
      "--service requires a Compose service name (for example web, postgres, console).",
    );
  }

  const tailFlag = flags.tail;
  if (tailFlag === true) {
    throw new PlatformCommandError(
      "usage",
      "--tail requires a positive integer (default 100).",
    );
  }
  let tail = DEFAULT_LOG_TAIL;
  if (typeof tailFlag === "string" && tailFlag.trim().length > 0) {
    if (!/^\d+$/.test(tailFlag.trim())) {
      throw new PlatformCommandError(
        "usage",
        `Invalid --tail value '${tailFlag}'; use an integer between 1 and ${String(MAX_LOG_TAIL)}.`,
      );
    }
    tail = Number(tailFlag.trim());
    if (tail < 1 || tail > MAX_LOG_TAIL) {
      throw new PlatformCommandError(
        "usage",
        `--tail must be between 1 and ${String(MAX_LOG_TAIL)}.`,
      );
    }
  }

  return { service, tail, follow };
}

export async function runPlatformLogs(
  installation: ResolvedInstallation,
  options: PlatformLogsOptions,
): Promise<number> {
  if (options.service !== undefined) {
    const known = KNOWN_COMPOSE_SERVICES.includes(
      options.service as (typeof KNOWN_COMPOSE_SERVICES)[number],
    );
    if (!known) {
      throw new PlatformCommandError(
        "usage",
        `Unknown service '${options.service}'. Expected one of: ${KNOWN_COMPOSE_SERVICES.join(", ")}.`,
      );
    }
  }

  const args = [
    "logs",
    `--tail=${String(options.tail)}`,
    ...(options.follow ? ["--follow"] : []),
    ...(options.service === undefined ? [] : [options.service]),
  ];

  const spawnEnv = buildComposeSpawnEnv(installation.execCtx);
  const dockerArgs = [...composeBaseArgs(installation.execCtx), ...args];

  if (options.follow) {
    const { exitCode } = await spawnStreamingCommand(
      "docker",
      dockerArgs,
      spawnEnv,
    );
    return exitCode === 0 ? 0 : 1;
  }

  const result = runComposeCommand(installation.execCtx, args, {
    timeoutMs: COMPOSE_LOGS_TIMEOUT_MS,
    processEnv: spawnEnv,
    spawn: (executable, spawnArgs, timeoutMs, processEnv) => {
      const output = defaultProbeSpawn(
        executable,
        spawnArgs,
        timeoutMs,
        processEnv,
      );
      if (output.stdout.length > 0) {
        process.stdout.write(redactSecrets(output.stdout));
        if (!output.stdout.endsWith("\n")) {
          process.stdout.write("\n");
        }
      }
      if (output.stderr.length > 0) {
        process.stderr.write(redactSecrets(output.stderr));
        if (!output.stderr.endsWith("\n")) {
          process.stderr.write("\n");
        }
      }
      return output;
    },
  });

  if (result.status !== 0) {
    throw new PlatformCommandError(
      "compose_failed",
      redactSecrets(
        result.stderr.trim() ||
          result.stdout.trim() ||
          "Failed to read service logs.",
      ),
    );
  }
  return 0;
}
