import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WorkspaceId } from "@osva/contracts";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import {
  createDatabase,
  migrateDatabase,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import { Workspace } from "@osva/domain";
import { createNodeHttpServer, createRuntime } from "@osva/sdk/runtime";

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

const WORKSPACE_ID = "ws-sdk-runtime" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");

describe("Node SDK runtime end-to-end", () => {
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

  it("executes through @osva/sdk runtime handler and completes the RunAttempt", async () => {
    const runtime = createRuntime({
      execute: async (input) => input,
    });
    const server = createNodeHttpServer(runtime);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("SDK runtime server failed to bind.");
    }
    const endpoint = `http://127.0.0.1:${String(address.port)}/execute`;

    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-sdk-runtime-e2e-"),
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
      const created = await createRemoteRun(origin, endpoint, {
        prompt: "sdk-runtime-e2e",
      });

      await waitUntil(async () => {
        const run = await fetchJson(`${origin}/v1/runs/${created.runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });

      const attempt = await fetchJson(
        `${origin}/v1/runs/${created.runId}/attempts/${created.runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        id: created.runAttemptId,
        status: "SUCCEEDED",
        output: { prompt: "sdk-runtime-e2e" },
      });
      expect(await inspector.countActiveJobs()).toBe(0);
    } finally {
      await worker.stop();
      await inspector.shutdown();
      await web.stop();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});

async function createRemoteRun(
  origin: string,
  endpoint: string,
  input: unknown,
): Promise<{ readonly runId: string; readonly runAttemptId: string }> {
  const agent = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: {
      workspaceId: WORKSPACE_ID,
      key: `sdk-runtime-${String(Date.now())}-${Math.random()}`,
      name: "SDK Runtime Agent",
    },
  });
  const agentId = (agent.body as { id: string }).id;
  const version = await fetchJson(`${origin}/v1/agents/${agentId}/versions`, {
    method: "POST",
    body: {
      manifest: {
        schemaVersion: "1",
        key: "sdk-runtime-agent",
        name: "SDK Runtime Agent",
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
  throw new Error("Timed out waiting for SDK runtime execution.");
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
