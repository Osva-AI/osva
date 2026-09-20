import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import postgres from "postgres";

import type { Database } from "../../src/database.js";

const HOST_POSTGRES_READY_ATTEMPTS = 40;
const HOST_POSTGRES_READY_DELAY_MS = 250;
const HOST_POSTGRES_CONNECT_TIMEOUT_SECONDS = 2;

const execFileAsync = promisify(execFile);

const STAGE0_TABLES = [
  "assignments",
  "team_memberships",
  "goals",
  "office_workers",
  "roles",
  "teams",
  "workflow_waits",
  "workflow_events",
  "approval_requests",
  "evaluation_case_results",
  "evaluation_runs",
  "evaluation_cases",
  "evaluation_suite_versions",
  "evaluation_suites",
  "memory_records",
  "memory_namespaces",
  "knowledge_vectors",
  "knowledge_chunks",
  "knowledge_indexes",
  "knowledge_sources",
  "artifacts",
  "workflow_node_runs",
  "workflow_runs",
  "workflow_versions",
  "workflows",
  "evaluations",
  "run_steps",
  "run_attempts",
  "runs",
  "schedule_occurrences",
  "schedules",
  "deployments",
  "agent_versions",
  "agents",
  "model_profile_versions",
  "model_profiles",
  "tool_versions",
  "tools",
  "connector_versions",
  "connectors",
  "workspaces",
] as const;

export interface PostgresTestContext {
  readonly connectionString: string;
  readonly usingDocker: boolean;
  readonly containerName?: string;
  readonly dockerBin?: string;
}

export async function startPostgresForTests(): Promise<PostgresTestContext> {
  const existingUrl = process.env.OSVA_TEST_DATABASE_URL?.trim();
  if (existingUrl !== undefined && existingUrl.length > 0) {
    await assertPgvectorCapable(existingUrl);
    return {
      connectionString: existingUrl,
      usingDocker: false,
    };
  }

  const dockerBin = await findDockerBin();
  if (dockerBin === undefined) {
    throw new Error(
      "Docker is required for @osva/db integration tests (pgvector/pgvector:pg17). Install Docker Desktop and ensure `docker --version` and `docker info` succeed, or set OSVA_TEST_DATABASE_URL to an isolated PostgreSQL database that provides the vector extension.",
    );
  }

  await assertDockerDaemon(dockerBin);
  const context = await startDockerPostgres(dockerBin);
  await assertPgvectorCapable(context.connectionString);
  return context;
}

export async function stopPostgresForTests(
  context: PostgresTestContext,
): Promise<void> {
  if (context.usingDocker && context.dockerBin && context.containerName) {
    await removeContainer(context.dockerBin, context.containerName);
  }
}

export async function resetStage0Tables(database: Database): Promise<void> {
  await database.sql.unsafe(
    `TRUNCATE TABLE ${STAGE0_TABLES.join(", ")} CASCADE`,
  );
}

/**
 * Integration tests require pgvector (migration 0020). Generic local PostgreSQL
 * installs without the extension are not a supported harness target.
 */
export async function assertPgvectorCapable(
  connectionString: string,
): Promise<void> {
  const sql = postgres(connectionString, {
    max: 1,
    connect_timeout: HOST_POSTGRES_CONNECT_TIMEOUT_SECONDS,
  });

  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    await sql`SELECT '[1,2,3]'::vector AS probe`;
  } catch (error) {
    throw new Error(
      `Integration test PostgreSQL must provide the pgvector extension (use Docker image pgvector/pgvector:pg17 or a pgvector-enabled OSVA_TEST_DATABASE_URL). ${formatUnknownError(error)}`,
    );
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
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
    "pgvector/pgvector:pg17",
  ]);

  try {
    const hostPort = await waitForPublishedPort(dockerBin, containerName);
    await waitForDockerPostgresReady(dockerBin, containerName);
    const connectionString = `postgres://osva:osva@127.0.0.1:${hostPort}/osva_test`;
    await waitForHostPostgresReady(connectionString);
    return {
      connectionString,
      usingDocker: true,
      containerName,
      dockerBin,
    };
  } catch (error) {
    await removeContainer(dockerBin, containerName);
    throw error;
  }
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
      "Docker is installed but the daemon is not available (`docker info` failed). Start Docker Desktop (pgvector/pgvector:pg17) or set OSVA_TEST_DATABASE_URL to a pgvector-capable isolated PostgreSQL database.",
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

async function waitForHostPostgresReady(
  connectionString: string,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < HOST_POSTGRES_READY_ATTEMPTS; attempt += 1) {
    const sql = postgres(connectionString, {
      max: 1,
      connect_timeout: HOST_POSTGRES_CONNECT_TIMEOUT_SECONDS,
    });

    try {
      await sql`select 1 as ok`;
      return;
    } catch (error) {
      lastError = error;
    } finally {
      await sql.end({ timeout: 5 }).catch(() => undefined);
    }

    await delay(HOST_POSTGRES_READY_DELAY_MS);
  }

  const detail = formatUnknownError(lastError);
  throw new Error(
    `Timed out waiting for host PostgreSQL at 127.0.0.1 after ${String(HOST_POSTGRES_READY_ATTEMPTS)} attempts. Last error: ${detail}`,
  );
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  return "unknown error";
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
