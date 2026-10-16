import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const helpersDir = path.dirname(fileURLToPath(import.meta.url));

export const CLI_ENTRY = path.join(
  helpersDir,
  "..",
  "..",
  "dist",
  "bin",
  "osva.js",
);

export type SubprocessResult = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

export class SubprocessStartError extends Error {
  constructor(
    message: string,
    readonly spawnError: Error,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "SubprocessStartError";
  }
}

export class SubprocessTimeoutError extends Error {
  constructor(
    message: string,
    readonly details: SubprocessResult,
  ) {
    super(message);
    this.name = "SubprocessTimeoutError";
  }
}

const activeChildren = new Set<ChildProcess>();

function trackChild(child: ChildProcess): void {
  activeChildren.add(child);
}

function untrackChild(child: ChildProcess): void {
  activeChildren.delete(child);
}

function waitForClose(
  child: ChildProcess,
  timeoutMs: number,
): Promise<number | null> {
  if (child.exitCode !== null) {
    return Promise.resolve(child.exitCode);
  }
  if (child.signalCode !== null) {
    return Promise.resolve(child.exitCode);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(child.exitCode);
    }, timeoutMs);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    await waitForClose(child, 2_000);
    return;
  }
  const pid = child.pid;
  if (pid === undefined) {
    await waitForClose(child, 2_000);
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };
    child.once("close", finish);
    const forceTimer = setTimeout(finish, 5_000);

    try {
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
          stdio: "ignore",
          shell: false,
          windowsHide: true,
        });
        killer.once("close", () => {
          clearTimeout(forceTimer);
          void waitForClose(child, 2_000).then(finish);
        });
        killer.once("error", () => {
          child.kill("SIGKILL");
        });
      } else {
        child.kill("SIGTERM");
        setTimeout(() => {
          child.kill("SIGKILL");
        }, 500);
      }
    } catch {
      finish();
    }
  });
}

export async function terminateTrackedSubprocesses(): Promise<void> {
  const children = [...activeChildren];
  await Promise.all(children.map((child) => terminateChild(child)));
}

export async function runSubprocess(
  executable: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs?: number;
  } = {},
): Promise<SubprocessResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const mergedEnv =
    options.env === undefined
      ? process.env
      : { ...process.env, ...options.env };

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: mergedEnv,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    trackChild(child);

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      untrackChild(child);
      reject(error);
    };

    const succeed = (code: number | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      untrackChild(child);
      resolve({ code, stdout, stderr });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      void terminateChild(child).then(() => {
        fail(
          new SubprocessTimeoutError(
            `Subprocess timed out after ${String(timeoutMs)}ms`,
            { code: child.exitCode, stdout, stderr },
          ),
        );
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (spawnError) => {
      fail(new SubprocessStartError(spawnError.message, spawnError, stderr));
    });
    child.on("close", (code) => {
      if (timedOut) {
        return;
      }
      succeed(code);
    });
  });
}

export function runCliSubprocess(
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs?: number;
  } = {},
): Promise<SubprocessResult> {
  return runSubprocess(process.execPath, [CLI_ENTRY, ...args], options);
}

export async function removeTempDir(dir: string): Promise<void> {
  await terminateTrackedSubprocesses();
  const { rm } = await import("node:fs/promises");
  await rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
