import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkspaceId } from "@osva/contracts";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import {
  createDatabase,
  migrateDatabase,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import { Workspace } from "@osva/domain";

import { createWebProcess } from "../../../web/src/process.js";
import { createWorkerProcess } from "../../src/process.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "../../../../packages/db/test/integration/postgres-harness.js";
import {
  startValkeyForTests,
  stopValkeyForTests,
  type ValkeyTestContext,
} from "../../../../adapters/bullmq/test/integration/valkey-harness.js";

const WORKSPACE_ID = "ws-python-sdk-runtime" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");
const PYTHON_SDK_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../sdks/python",
);
const MAX_PROCESS_OUTPUT_CHARS = 8_192;

describe("Python SDK runtime end-to-end", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
    if (postgres) {
      await stopPostgresForTests(postgres);
    }
    if (valkey) {
      await stopValkeyForTests(valkey);
    }
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await new PostgresWorkspaceRepository(database).save(
      Workspace.create({
        id: WORKSPACE_ID,
        name: "Workspace",
        createdAt: NOW,
      }),
    );
  });

  it("executes through the Python SDK runtime and completes the RunAttempt", async () => {
    const pythonRuntime = await startPythonRuntimeServer();
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-python-sdk-runtime-e2e-"),
    );
    const web = createWebProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
    });
    const worker = createWorkerProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      OSVA_RUNTIME_CAPABILITY_SECRET: "capability-secret",
      OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS: "true",
    });
    const inspector = new BullMqJobQueue({ url: valkey.url });

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const created = await createRemoteRun(
        origin,
        `${pythonRuntime.origin}/execute`,
        { value: "python-sdk-e2e" },
      );

      await waitUntil(async () => {
        const run = await fetchJson(`${origin}/v1/runs/${created.runId}`);
        const status = (run.body as { status?: string }).status;
        if (status === "FAILED") {
          const attempt = await fetchJson(
            `${origin}/v1/runs/${created.runId}/attempts/${created.runAttemptId}`,
          );
          throw new Error(
            `Run failed: ${JSON.stringify(attempt.body)} stderr=${pythonRuntime.stderr}`,
          );
        }
        return status === "SUCCEEDED";
      });

      const attempt = await fetchJson(
        `${origin}/v1/runs/${created.runId}/attempts/${created.runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        id: created.runAttemptId,
        status: "SUCCEEDED",
        output: { echo: { value: "python-sdk-e2e" } },
      });
      expect(await inspector.countActiveJobs()).toBe(0);
    } finally {
      await worker.stop();
      await inspector.shutdown();
      await web.stop();
      await pythonRuntime.close();
    }
  });
});

async function startPythonRuntimeServer(): Promise<{
  origin: string;
  stderr: string;
  close(): Promise<void>;
}> {
  const scriptPath = path.join(
    PYTHON_SDK_ROOT,
    "scripts/integration_runtime_server.py",
  );
  let stderr = "";
  let stdout = "";
  const child = spawn(
    "python",
    [scriptPath, "--host", "127.0.0.1", "--port", "0"],
    {
      cwd: PYTHON_SDK_ROOT,
      env: {
        ...process.env,
        PYTHONPATH: path.join(PYTHON_SDK_ROOT, "src"),
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = appendBoundedProcessOutput(stderr, chunk.toString("utf8"));
  });

  const origin = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for Python runtime server startup.${formatPythonProcessOutput({ stdout, stderr })}`,
        ),
      );
    }, 10_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendBoundedProcessOutput(stdout, chunk.toString("utf8"));
      const line = stdout
        .split("\n")
        .map((value) => value.trim())
        .find((value) => value.startsWith("{"));
      if (line === undefined) {
        return;
      }
      try {
        const parsed = JSON.parse(line) as { host?: string; port?: number };
        if (parsed.host !== undefined && parsed.port !== undefined) {
          clearTimeout(timer);
          resolve(`http://${parsed.host}:${String(parsed.port)}`);
        }
      } catch {
        // keep waiting
      }
    });

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(
        new Error(
          `${error instanceof Error ? error.message : String(error)}${formatPythonProcessOutput({ stdout, stderr })}`,
        ),
      );
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Python runtime server exited early with code ${String(code)}.${formatPythonProcessOutput({ stdout, stderr })}`,
        ),
      );
    });
  });

  return {
    origin,
    get stderr() {
      return stderr;
    },
    close: async () => {
      await stopProcess(child);
    },
  };
}

function appendBoundedProcessOutput(current: string, chunk: string): string {
  const next = current + chunk;
  if (next.length <= MAX_PROCESS_OUTPUT_CHARS) {
    return next;
  }
  return next.slice(-MAX_PROCESS_OUTPUT_CHARS);
}

function formatPythonProcessOutput(output: {
  stdout: string;
  stderr: string;
}): string {
  const sections: string[] = [];
  const trimmedStdout = output.stdout.trim();
  const trimmedStderr = output.stderr.trim();
  if (trimmedStderr.length > 0) {
    sections.push(`stderr:\n${trimmedStderr}`);
  }
  if (trimmedStdout.length > 0) {
    sections.push(`stdout:\n${trimmedStdout}`);
  }
  if (sections.length === 0) {
    return "";
  }
  return `\n\n${sections.join("\n\n")}`;
}

async function stopProcess(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);
  });
}

async function createRemoteRun(
  origin: string,
  endpoint: string,
  input: unknown,
): Promise<{ readonly runId: string; readonly runAttemptId: string }> {
  const agent = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: {
      workspaceId: WORKSPACE_ID,
      key: `python-runtime-${String(Date.now())}-${Math.random()}`,
      name: "Python Runtime Agent",
    },
  });
  const agentId = (agent.body as { id: string }).id;
  const version = await fetchJson(`${origin}/v1/agents/${agentId}/versions`, {
    method: "POST",
    body: {
      manifest: {
        schemaVersion: "1",
        key: "python-runtime-agent",
        name: "Python Runtime Agent",
        runtime: {
          type: "REMOTE_HTTP",
          protocolVersion: "1",
          endpoint,
        },
        input: { schema: {} },
        output: { schema: {} },
        execution: { timeoutMs: 8_000, maxAttempts: 1 },
        capabilities: { model: false, tools: [] },
      },
    },
  });
  expect(version.status).toBe(201);
  const created = await fetchJson(`${origin}/v1/runs`, {
    method: "POST",
    body: {
      workspaceId: WORKSPACE_ID,
      agentId,
      agentVersionId: (version.body as { id: string }).id,
      input,
    },
  });
  expect(created.status).toBe(201);
  return {
    runId: (created.body as { run: { id: string } }).run.id,
    runAttemptId: (created.body as { runAttempt: { id: string } }).runAttempt
      .id,
  };
}

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  throw new Error("Timed out waiting for Python SDK runtime execution.");
}

async function fetchJson(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: init.body ? { "content-type": "application/json" } : undefined,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: response.status, body: await response.json() };
}
