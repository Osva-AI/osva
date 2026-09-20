import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceId } from "@osva/contracts";
import {
  sha256IntegrityOf,
  TrustedTypeScriptRuntimeAdapter,
} from "@osva/adapters-runtime-typescript";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import {
  createDatabase,
  migrateDatabase,
  PostgresRunRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import { Workspace } from "@osva/domain";

import { createWebProcess } from "../../../../apps/web/src/process.js";
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

const WORKSPACE_ID = "ws-trusted" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

describe("trusted TypeScript runtime end-to-end", () => {
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

  it("runs HTTP CreateRun through the trusted runtime and persists output", async () => {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-e2e-runtime-"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, "echo-agent.ts"),
      path.join(trustedRuntimeRoot, "echo-agent.ts"),
    );
    const integrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, "echo-agent.ts")),
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
    });
    const inspector = new BullMqJobQueue({ url: valkey.url });

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;

      const agent = await fetchJson(`${origin}/v1/agents`, {
        method: "POST",
        body: {
          workspaceId: WORKSPACE_ID,
          key: "echo-agent",
          name: "Echo Agent",
        },
      });
      expect(agent.status).toBe(201);
      const agentId = (agent.body as { id: string }).id;

      const version = await fetchJson(
        `${origin}/v1/agents/${agentId}/versions`,
        {
          method: "POST",
          body: {
            manifest: trustedManifest("echo-agent.ts", integrity),
          },
        },
      );
      expect(version.status).toBe(201);
      const agentVersionId = (version.body as { id: string }).id;

      const created = await fetchJson(`${origin}/v1/runs`, {
        method: "POST",
        body: {
          workspaceId: WORKSPACE_ID,
          agentId,
          agentVersionId,
          input: { prompt: "e2e" },
        },
      });
      expect(created.status).toBe(201);
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitUntil(async () => {
        const run = await fetchJson(`${origin}/v1/runs/${runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });

      const attempt = await fetchJson(
        `${origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.status).toBe(200);
      expect(attempt.body).toMatchObject({
        id: runAttemptId,
        status: "SUCCEEDED",
        output: {
          echoed: { prompt: "e2e" },
          ids: {
            runId,
            runAttemptId,
            workspaceId: WORKSPACE_ID,
            agentId,
            agentVersionId,
          },
        },
      });
      expect(await inspector.countActiveJobs()).toBe(0);
    } finally {
      await worker.stop();
      await inspector.shutdown();
      await web.stop();
    }
  });

  it("does not re-execute a terminal attempt on queue redelivery", async () => {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-e2e-redeliver-"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, "echo-agent.ts"),
      path.join(trustedRuntimeRoot, "echo-agent.ts"),
    );
    const integrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, "echo-agent.ts")),
    );

    let executions = 0;
    const inner = new TrustedTypeScriptRuntimeAdapter({
      trustedRuntimeRoot,
    });
    const web = createWebProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
    });
    const producer = new BullMqJobQueue({ url: valkey.url });
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        runtime: {
          async execute(request) {
            executions += 1;
            return inner.execute(request);
          },
          async close() {
            await inner.close();
          },
        },
      },
    );

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const created = await createTrustedRun(
        origin,
        "echo-agent.ts",
        integrity,
        { prompt: "once" },
      );

      await waitUntil(async () => {
        const run = await fetchJson(`${origin}/v1/runs/${created.runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });
      expect(executions).toBe(1);

      await producer.enqueue(created.runAttemptId);
      await delay(500);

      const attempt = await fetchJson(
        `${origin}/v1/runs/${created.runId}/attempts/${created.runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: { echoed: { prompt: "once" } },
      });
      expect(executions).toBe(1);
    } finally {
      await worker.stop();
      await producer.shutdown();
      await web.stop();
    }
  });

  it("creates and reads artifacts through the trusted runtime artifact capability", async () => {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-e2e-artifact-"),
    );
    const artifactRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-e2e-artifact-store-"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, "artifact-echo-agent.ts"),
      path.join(trustedRuntimeRoot, "artifact-echo-agent.ts"),
    );
    const integrity = sha256IntegrityOf(
      await fs.readFile(
        path.join(trustedRuntimeRoot, "artifact-echo-agent.ts"),
      ),
    );

    const sharedEnv = {
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_ARTIFACT_FILESYSTEM_ROOT: artifactRoot,
    };

    const web = createWebProcess({
      ...sharedEnv,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
    });
    const worker = createWorkerProcess({
      ...sharedEnv,
      OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
    });
    const inspector = new BullMqJobQueue({ url: valkey.url });

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const payload = "trusted-runtime-artifact-round-trip";

      const created = await createTrustedRun(
        origin,
        "artifact-echo-agent.ts",
        integrity,
        { content: payload },
      );

      await waitUntil(async () => {
        const run = await fetchJson(`${origin}/v1/runs/${created.runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });

      const attempt = await fetchJson(
        `${origin}/v1/runs/${created.runId}/attempts/${created.runAttemptId}`,
      );
      expect(attempt.status).toBe(200);
      expect(attempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: {
          name: "runtime-artifact.txt",
          sizeBytes: payload.length,
          roundTrip: payload,
          fetchedName: "runtime-artifact.txt",
        },
      });
      const artifactId = (attempt.body as { output: { artifactId: string } })
        .output.artifactId;
      expect(artifactId.length).toBeGreaterThan(0);
      expect(await inspector.countActiveJobs()).toBe(0);
    } finally {
      await worker.stop();
      await inspector.shutdown();
      await web.stop();
    }
  });

  it("persists FAILED Run/RunAttempt for trusted agent errors while completing the queue message", async () => {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-e2e-fail-"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, "throw-agent.ts"),
      path.join(trustedRuntimeRoot, "throw-agent.ts"),
    );
    const integrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, "throw-agent.ts")),
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
    });
    const inspector = new BullMqJobQueue({ url: valkey.url });
    const runs = new PostgresRunRepository(database);

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const created = await createTrustedRun(
        origin,
        "throw-agent.ts",
        integrity,
        { prompt: "fail" },
      );

      await waitUntil(async () => {
        const run = await runs.findRunById(created.runId);
        return run?.status === "FAILED";
      });

      const attempt = await fetchJson(
        `${origin}/v1/runs/${created.runId}/attempts/${created.runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "FAILED",
        error: { code: "AGENT_EXECUTION_ERROR" },
      });
      expect((attempt.body as { output?: unknown }).output).toBeUndefined();
      expect(await inspector.countActiveJobs()).toBe(0);
    } finally {
      await worker.stop();
      await inspector.shutdown();
      await web.stop();
    }
  });
});

function trustedManifest(entrypoint: string, integrity: string) {
  return {
    schemaVersion: "1",
    key: "trusted-agent",
    name: "Trusted Agent",
    runtime: {
      type: "TRUSTED_TYPESCRIPT",
      entrypoint,
      integrity,
    },
    input: { schema: {} },
    output: { schema: {} },
    execution: { timeoutMs: 5_000, maxAttempts: 1 },
    capabilities: { model: false, tools: [] },
  };
}

async function createTrustedRun(
  origin: string,
  entrypoint: string,
  integrity: string,
  input: unknown,
): Promise<{
  readonly runId: string;
  readonly runAttemptId: string;
}> {
  const agent = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: {
      workspaceId: WORKSPACE_ID,
      key: `agent-${entrypoint}`,
      name: "Trusted Agent",
    },
  });
  const agentId = (agent.body as { id: string }).id;
  const version = await fetchJson(`${origin}/v1/agents/${agentId}/versions`, {
    method: "POST",
    body: { manifest: trustedManifest(entrypoint, integrity) },
  });
  const agentVersionId = (version.body as { id: string }).id;
  const created = await fetchJson(`${origin}/v1/runs`, {
    method: "POST",
    body: {
      workspaceId: WORKSPACE_ID,
      agentId,
      agentVersionId,
      input,
    },
  });
  return {
    runId: (created.body as { run: { id: string } }).run.id,
    runAttemptId: (created.body as { runAttempt: { id: string } }).runAttempt
      .id,
  };
}

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await delay(50);
  }
  throw new Error("Timed out waiting for trusted runtime execution.");
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
