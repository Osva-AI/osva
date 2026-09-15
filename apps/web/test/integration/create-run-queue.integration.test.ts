import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceId } from "@osva/contracts";
import { BullMqJobQueue, toBullMqJobId } from "@osva/adapters-bullmq";
import {
  createDatabase,
  migrateDatabase,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import { Workspace } from "@osva/domain";

import { createWebProcess } from "../../src/process.js";
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

const WORKSPACE_ID = "ws-compose" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");

const VALID_MANIFEST = {
  schemaVersion: "1",
  key: "example-agent",
  name: "Example Agent",
  runtime: {
    type: "BUILTIN_PACKAGE",
    key: "example-agent",
  },
  input: { schema: {} },
  output: { schema: {} },
  execution: { timeoutMs: 30_000, maxAttempts: 2 },
  capabilities: { model: false, tools: [] },
};

describe("web CreateRun BullMQ integration", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let seedDatabase: Database;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    seedDatabase = createDatabase({
      connectionString: postgres.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(seedDatabase);
  });

  afterAll(async () => {
    if (seedDatabase) {
      await seedDatabase.close();
    }
    if (postgres) {
      await stopPostgresForTests(postgres);
    }
    if (valkey) {
      await stopValkeyForTests(valkey);
    }
  });

  beforeEach(async () => {
    await resetStage0Tables(seedDatabase);
    await new PostgresWorkspaceRepository(seedDatabase).save(
      Workspace.create({
        id: WORKSPACE_ID,
        name: "Workspace",
        createdAt: NOW,
      }),
    );
  });

  it("enqueues exactly { runAttemptId } through real BullMQ", async () => {
    const web = createWebProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
    });
    const inspector = new BullMqJobQueue({ url: valkey.url });

    try {
      const port = await web.listen();
      const origin = `http://127.0.0.1:${String(port)}`;

      const ready = await fetch(`${origin}/ready`);
      expect(ready.status).toBe(200);

      const agent = await fetchJson(`${origin}/v1/agents`, {
        method: "POST",
        body: {
          workspaceId: WORKSPACE_ID,
          key: "example-agent",
          name: "Example Agent",
        },
      });
      expect(agent.status).toBe(201);
      const agentId = (agent.body as { id: string }).id;

      const version = await fetchJson(
        `${origin}/v1/agents/${agentId}/versions`,
        {
          method: "POST",
          body: { manifest: VALID_MANIFEST },
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
          input: { prompt: "queue me" },
        },
      });
      expect(created.status).toBe(201);
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      const job = await waitForJob(inspector, runAttemptId);
      expect(job.name).toBe("execute-run-attempt");
      expect(job.id).toBe(toBullMqJobId(runAttemptId));
      expect(job.data).toEqual({ runAttemptId });
    } finally {
      await inspector.shutdown();
      await web.stop();
    }
  });
});

async function waitForJob(
  inspector: BullMqJobQueue,
  runAttemptId: string,
): Promise<{ id: string; name: string; data: unknown }> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const job = await inspector.getQueuedJob(runAttemptId);
    if (job !== null) {
      return job;
    }
    await delay(50);
  }
  throw new Error("Timed out waiting for BullMQ job.");
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
