import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { Database } from "../../src/database.js";

const execFileAsync = promisify(execFile);

const STAGE0_TABLES = [
  "run_steps",
  "run_attempts",
  "runs",
  "deployments",
  "agent_versions",
  "agents",
  "workspaces",
] as const;

export interface PostgresTestContext {
  readonly connectionString: string;
  readonly usingDocker: boolean;
  readonly containerName?: string;
  readonly dockerBin?: string;
  readonly dataDir?: string;
  readonly postgresBinDir?: string;
}

export async function startPostgresForTests(): Promise<PostgresTestContext> {
  const existingUrl = process.env.OSVA_TEST_DATABASE_URL;
  if (existingUrl) {
    return {
      connectionString: existingUrl,
      usingDocker: false,
    };
  }

  const dockerBin = await findDockerBin();
  if (dockerBin) {
    try {
      await assertDockerDaemon(dockerBin);
      return await startDockerPostgres(dockerBin);
    } catch (error) {
      if (findPostgresBinDir()) {
        return startLocalPostgresCluster();
      }
      throw error;
    }
  }

  if (findPostgresBinDir()) {
    return startLocalPostgresCluster();
  }

  throw new Error(
    "A real PostgreSQL instance is required for @osva/db integration tests. Install Docker Desktop and ensure `docker --version` and `docker info` succeed, provide PostgreSQL binaries (initdb/pg_ctl), or set OSVA_TEST_DATABASE_URL to an isolated database.",
  );
}

export async function stopPostgresForTests(
  context: PostgresTestContext,
): Promise<void> {
  if (context.usingDocker && context.dockerBin && context.containerName) {
    await removeContainer(context.dockerBin, context.containerName);
    return;
  }

  if (context.dataDir && context.postgresBinDir) {
    await stopLocalPostgresCluster(context.postgresBinDir, context.dataDir);
  }
}

export async function resetStage0Tables(database: Database): Promise<void> {
  await database.sql.unsafe(
    `TRUNCATE TABLE ${STAGE0_TABLES.join(", ")} CASCADE`,
  );
}

async function startDockerPostgres(
  dockerBin: string,
): Promise<PostgresTestContext> {
  const containerName = `osva-db-itest-${String(process.pid)}-${String(Date.now())}`;
  await execFileAsync(dockerBin, [
    "run",
    "--detach",
    "--name",
    containerName,
    "--env",
    "POSTGRES_USER=osva",
    "--env",
    "POSTGRES_PASSWORD=osva",
    "--env",
    "POSTGRES_DB=osva_test",
    "--publish",
    "127.0.0.1::5432",
    "postgres:17-alpine",
  ]);

  try {
    const hostPort = await waitForPublishedPort(dockerBin, containerName);
    await waitForDockerPostgresReady(dockerBin, containerName);
    return {
      connectionString: `postgres://osva:osva@127.0.0.1:${hostPort}/osva_test`,
      usingDocker: true,
      containerName,
      dockerBin,
    };
  } catch (error) {
    await removeContainer(dockerBin, containerName);
    throw error;
  }
}

async function startLocalPostgresCluster(): Promise<PostgresTestContext> {
  const postgresBinDir = findPostgresBinDir();
  if (!postgresBinDir) {
    throw new Error("PostgreSQL binaries were not found.");
  }

  const dataDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "osva-db-itest-"),
  );
  const port = await getFreePort();
  const env = localPostgresEnv(postgresBinDir);

  try {
    await execFileAsync(
      bin(postgresBinDir, "initdb"),
      [
        "-D",
        dataDir,
        "-U",
        "osva",
        "-A",
        "trust",
        "-E",
        "UTF8",
        "--no-locale",
        "--no-instructions",
      ],
      { env, timeout: 120_000, windowsHide: true },
    );

    await runWithIgnoredStdio(
      bin(postgresBinDir, "pg_ctl"),
      [
        "-D",
        dataDir,
        "-l",
        path.join(dataDir, "pg.log"),
        "-o",
        `-p ${String(port)} -h 127.0.0.1`,
        "start",
      ],
      env,
      60_000,
    );

    await waitForLocalPostgresReady(postgresBinDir, port);
    await execFileAsync(
      bin(postgresBinDir, "createdb"),
      ["-h", "127.0.0.1", "-p", String(port), "-U", "osva", "osva_test"],
      { env },
    );

    return {
      connectionString: `postgres://osva@127.0.0.1:${String(port)}/osva_test`,
      usingDocker: false,
      dataDir,
      postgresBinDir,
    };
  } catch (error) {
    await stopLocalPostgresCluster(postgresBinDir, dataDir);
    throw error;
  }
}

async function stopLocalPostgresCluster(
  postgresBinDir: string,
  dataDir: string,
): Promise<void> {
  try {
    await runWithIgnoredStdio(
      bin(postgresBinDir, "pg_ctl"),
      ["-D", dataDir, "stop", "-m", "fast"],
      localPostgresEnv(postgresBinDir),
      30_000,
    );
  } catch {
    // The cluster may already have failed to start.
  }

  await removeDirectory(dataDir);
}

function localPostgresEnv(postgresBinDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${postgresBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
  };
}

function bin(postgresBinDir: string, name: string): string {
  const executable = process.platform === "win32" ? `${name}.exe` : name;
  return path.join(postgresBinDir, executable);
}

function findPostgresBinDir(): string | undefined {
  const candidates = [
    process.env.POSTGRES_BIN,
    path.join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "PostgreSQL",
      "17",
      "bin",
    ),
    path.join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "PostgreSQL",
      "16",
      "bin",
    ),
    "/usr/lib/postgresql/17/bin",
    "/usr/lib/postgresql/16/bin",
    "/usr/local/bin",
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (
      fs.existsSync(bin(candidate, "initdb")) &&
      fs.existsSync(bin(candidate, "pg_ctl"))
    ) {
      return candidate;
    }
  }

  return undefined;
}

async function findDockerBin(): Promise<string | undefined> {
  const candidates = [
    "docker",
    path.join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "Docker",
      "Docker",
      "resources",
      "bin",
      "docker.exe",
    ),
    path.join(process.env.USERPROFILE ?? "", ".docker", "bin", "docker.exe"),
  ];

  for (const candidate of candidates) {
    if (candidate !== "docker" && !fs.existsSync(candidate)) {
      continue;
    }

    try {
      await execFileAsync(candidate, ["--version"]);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

async function assertDockerDaemon(dockerBin: string): Promise<void> {
  try {
    await execFileAsync(dockerBin, ["info"]);
  } catch {
    throw new Error(
      "Docker is installed but the daemon is not available (`docker info` failed). Start Docker Desktop or set OSVA_TEST_DATABASE_URL to an isolated PostgreSQL database.",
    );
  }
}

async function waitForPublishedPort(
  dockerBin: string,
  containerName: string,
): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(dockerBin, [
        "port",
        containerName,
        "5432/tcp",
      ]);
      const match = stdout.trim().match(/:(\d+)\s*$/);
      if (match?.[1]) {
        return match[1];
      }
    } catch {
      // Container may not have published the port yet.
    }

    await delay(250);
  }

  throw new Error(
    `Timed out waiting for published PostgreSQL port on container '${containerName}'.`,
  );
}

async function waitForDockerPostgresReady(
  dockerBin: string,
  containerName: string,
): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await execFileAsync(dockerBin, [
        "exec",
        containerName,
        "pg_isready",
        "-U",
        "osva",
        "-d",
        "osva_test",
      ]);
      return;
    } catch {
      await delay(500);
    }
  }

  throw new Error(
    `Timed out waiting for PostgreSQL to become ready in container '${containerName}'.`,
  );
}

async function waitForLocalPostgresReady(
  postgresBinDir: string,
  port: number,
): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await execFileAsync(
        bin(postgresBinDir, "pg_isready"),
        ["-h", "127.0.0.1", "-p", String(port), "-U", "osva"],
        { env: localPostgresEnv(postgresBinDir) },
      );
      return;
    } catch {
      await delay(250);
    }
  }

  throw new Error(
    `Timed out waiting for local PostgreSQL cluster on port ${String(port)}.`,
  );
}

async function removeContainer(
  dockerBin: string,
  containerName: string,
): Promise<void> {
  try {
    await execFileAsync(dockerBin, ["rm", "-f", containerName]);
  } catch {
    // Best-effort cleanup for a temporary test container.
  }
}

async function removeDirectory(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await fs.promises.rm(directory, { recursive: true, force: true });
      return;
    } catch {
      await delay(250);
    }
  }
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        server.close();
        reject(new Error("Failed to allocate a local TCP port."));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function runWithIgnoredStdio(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      env,
      stdio: "ignore",
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `Timed out after ${String(timeoutMs)}ms running '${command} ${args.join(" ")}'.`,
        ),
      );
    }, timeoutMs);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `'${command} ${args.join(" ")}' exited with code ${String(code)}.`,
        ),
      );
    });
  });
}
