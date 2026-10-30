import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnSyncReturns,
} from "node:child_process";

import { createStreamingSecretRedactor } from "../doctor/streaming-redact.js";

export interface ProbeSpawnResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error: NodeJS.ErrnoException | undefined;
}

export type ProbeSpawnFn = (
  executable: string,
  args: readonly string[],
  timeoutMs: number,
  processEnv?: NodeJS.ProcessEnv,
) => ProbeSpawnResult;

/** Cap Docker probe output buffering (spawnSync default is 1 MiB). */
export const PROBE_SPAWN_MAX_BUFFER_BYTES = 256 * 1024;

export function defaultProbeSpawn(
  executable: string,
  args: readonly string[],
  timeoutMs: number,
  processEnv: NodeJS.ProcessEnv = process.env,
): ProbeSpawnResult {
  let result: SpawnSyncReturns<string>;
  try {
    result = spawnSync(executable, [...args], {
      encoding: "utf8",
      stdio: "pipe",
      shell: false,
      timeout: timeoutMs,
      maxBuffer: PROBE_SPAWN_MAX_BUFFER_BYTES,
      env: processEnv,
    });
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    return {
      status: null,
      stdout: "",
      stderr: errno.message ?? String(error),
      error: errno,
    };
  }
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

/** Stream subprocess stdout/stderr with bounded chunk-safe secret redaction. */
export function spawnStreamingCommand(
  executable: string,
  args: readonly string[],
  processEnv: NodeJS.ProcessEnv = process.env,
): Promise<{
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(executable, [...args], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        env: processEnv,
      });
    } catch (error) {
      reject(error);
      return;
    }

    const stdoutRedactor = createStreamingSecretRedactor((text) => {
      process.stdout.write(text);
    });
    const stderrRedactor = createStreamingSecretRedactor((text) => {
      process.stderr.write(text);
    });
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdoutRedactor.write(
        typeof chunk === "string" ? chunk : chunk.toString("utf8"),
      );
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderrRedactor.write(
        typeof chunk === "string" ? chunk : chunk.toString("utf8"),
      );
    });

    const onInterrupt = (): void => {
      if (child.killed) {
        return;
      }
      if (process.platform === "win32") {
        child.kill();
      } else {
        child.kill("SIGTERM");
      }
    };
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onInterrupt);

    child.on("error", (error) => {
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onInterrupt);
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      stdoutRedactor.flush();
      stderrRedactor.flush();
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onInterrupt);
      resolve({ exitCode, signal });
    });
  });
}
