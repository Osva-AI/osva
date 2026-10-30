import { spawnSync, type SpawnSyncReturns } from "node:child_process";

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
) => ProbeSpawnResult;

/** Cap Docker probe output buffering (spawnSync default is 1 MiB). */
export const PROBE_SPAWN_MAX_BUFFER_BYTES = 256 * 1024;

export function defaultProbeSpawn(
  executable: string,
  args: readonly string[],
  timeoutMs: number,
): ProbeSpawnResult {
  let result: SpawnSyncReturns<string>;
  try {
    result = spawnSync(executable, [...args], {
      encoding: "utf8",
      stdio: "pipe",
      shell: false,
      timeout: timeoutMs,
      maxBuffer: PROBE_SPAWN_MAX_BUFFER_BYTES,
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
