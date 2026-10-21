import fs from "node:fs/promises";
import { withTestAuthEnv } from "../../../../packages/db/test/integration/web-auth-env.js";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  AgentVersionId,
  MemoryNamespaceId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import {
  createDatabase,
  migrateDatabase,
  PostgresAgentRepository,
  PostgresMemoryNamespaceRepository,
  PostgresRunRepository,
  type Database,
} from "@osva/db";
import { createExecutionRequest } from "@osva/runtime-core";

import { createWebProcess } from "../../../../apps/web/src/process.js";
import { bootstrapIntegrationAuth, fetchJson } from "./integration-auth.js";
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

const WORKSPACE_ID = "ws-playground-memory" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

describe("Playground restrictPersistentMemory worker integration", () => {
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
    await bootstrapIntegrationAuth(database, WORKSPACE_ID, NOW);
  });

  it("denies durable memory writes for ad-hoc runs with restrictPersistentMemory=true", async () => {
    const ctx = await startMemoryEchoStack(
      database,
      postgres.connectionString,
      valkey,
    );
    try {
      const { origin, agentId, agentVersionId, namespaceId } = ctx;

      const created = await fetchJson(`${origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId,
          agentVersionId,
          input: { memoryKey: "greeting" },
          restrictPersistentMemory: true,
        },
      });
      expect(created.status).toBe(201);
      const runId = (created.body as { run: { id: RunId } }).run.id;
      const runAttemptId = (
        created.body as { runAttempt: { id: RunAttemptId } }
      ).runAttempt.id;

      expect(created.body).toMatchObject({
        run: { restrictPersistentMemory: true },
      });

      const queued = await fetchJson(`${origin}/v1/runs/${runId}`);
      expect(queued.status).toBe(200);
      expect(queued.body).toMatchObject({
        status: expect.stringMatching(/^(PENDING|QUEUED|RUNNING|SUCCEEDED)$/),
        restrictPersistentMemory: true,
      });

      await waitForRunTerminal(origin, runId);

      const terminal = await fetchJson(`${origin}/v1/runs/${runId}`);
      expect(terminal.body).toMatchObject({
        status: "SUCCEEDED",
        restrictPersistentMemory: true,
      });

      const attempt = await fetchJson(
        `${origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: {
          writeBlocked: true,
          writeErrorCode: "MEMORY_PERMISSION_DENIED",
          memoryValue: { text: "seeded" },
          memoryRevision: 1,
        },
      });

      const runs = new PostgresRunRepository(database);
      const agents = new PostgresAgentRepository(database);
      const persistedRun = await runs.findRunById(runId);
      expect(persistedRun?.restrictPersistentMemory).toBe(true);
      expect(persistedRun?.status).toBe("SUCCEEDED");

      const agentVersion = await agents.findAgentVersionById(
        agentVersionId as AgentVersionId,
      );
      expect(agentVersion).not.toBeNull();
      const attemptEntity = await runs.findRunAttemptById(runAttemptId);
      expect(attemptEntity).not.toBeNull();

      const executionRequest = createExecutionRequest({
        run: persistedRun!,
        runAttempt: attemptEntity!,
        agentVersion: agentVersion!,
      });
      expect(executionRequest.restrictPersistentMemory).toBe(true);

      const seeded = await ctx.memoryRepository.getRecord(
        namespaceId,
        "greeting",
      );
      expect(seeded?.value).toEqual({ text: "seeded" });
      expect(seeded?.revision).toBe(1);
    } finally {
      await ctx.shutdown();
    }
  });

  it("allows durable memory writes for ad-hoc runs without restrictPersistentMemory", async () => {
    const ctx = await startMemoryEchoStack(
      database,
      postgres.connectionString,
      valkey,
    );
    try {
      const { origin, agentId, agentVersionId, namespaceId } = ctx;

      const created = await fetchJson(`${origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId,
          agentVersionId,
          input: { memoryKey: "greeting" },
          restrictPersistentMemory: false,
        },
      });
      expect(created.status).toBe(201);
      const runId = (created.body as { run: { id: RunId } }).run.id;

      await waitForRunTerminal(origin, runId);

      const attemptList = await fetchJson(
        `${origin}/v1/runs/${runId}/attempts`,
      );
      const attemptId = (
        attemptList.body as { attempts: Array<{ id: RunAttemptId }> }
      ).attempts[0]!.id;
      const attempt = await fetchJson(
        `${origin}/v1/runs/${runId}/attempts/${attemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: {
          writeBlocked: false,
          writeErrorCode: null,
        },
      });

      const runs = new PostgresRunRepository(database);
      const persistedRun = await runs.findRunById(runId);
      expect(persistedRun?.restrictPersistentMemory).toBe(false);

      const updated = await ctx.memoryRepository.getRecord(
        namespaceId,
        "greeting",
      );
      expect(updated?.value).toEqual({ overwritten: true });
      expect(updated?.revision).toBe(2);
    } finally {
      await ctx.shutdown();
    }
  });

  it("keeps evaluation child memory isolation independent of restrictPersistentMemory on create", async () => {
    const ctx = await startMemoryEchoStack(
      database,
      postgres.connectionString,
      valkey,
    );
    try {
      const { origin, agentVersionId, namespaceId } = ctx;

      const suite = await fetchJson(`${origin}/v1/evaluation-suites`, {
        method: "POST",
        body: { key: "playground-eval-regression", name: "Regression" },
      });
      expect(suite.status).toBe(201);
      const evaluationSuiteId = (suite.body as { id: string }).id;

      const suiteVersion = await fetchJson(
        `${origin}/v1/evaluation-suites/${evaluationSuiteId}/versions`,
        {
          method: "POST",
          body: {
            cases: [
              {
                key: "memory-blocked",
                input: { memoryKey: "greeting" },
                evaluator: {
                  type: "JSON_EXACT_MATCH",
                  expected: {
                    echoed: { memoryKey: "greeting" },
                    memoryValue: { text: "seeded" },
                    memoryRevision: 1,
                    writeBlocked: true,
                    writeErrorCode: "MEMORY_PERMISSION_DENIED",
                  },
                },
              },
            ],
          },
        },
      );
      expect(suiteVersion.status).toBe(201);
      const evaluationSuiteVersionId = (suiteVersion.body as { id: string }).id;

      const evaluationRun = await fetchJson(`${origin}/v1/evaluation-runs`, {
        method: "POST",
        body: {
          evaluationSuiteVersionId,
          targetType: "AGENT_VERSION",
          targetVersionId: agentVersionId,
        },
      });
      expect(evaluationRun.status).toBe(201);
      const evaluationRunId = (evaluationRun.body as { id: string }).id;

      await waitUntil(async () => {
        const detail = await fetchJson(
          `${origin}/v1/evaluation-runs/${evaluationRunId}`,
        );
        return (
          detail.status === 200 &&
          (detail.body as { status?: string }).status === "COMPLETED"
        );
      });

      const caseResults = await fetchJson(
        `${origin}/v1/evaluation-runs/${evaluationRunId}/case-results`,
      );
      const childRunId = (
        caseResults.body as { items: Array<{ runId: RunId; outcome: string }> }
      ).items[0]!.runId;
      expect(
        (caseResults.body as { items: Array<{ outcome: string }> }).items[0]
          ?.outcome,
      ).toBe("PASS");

      const childRun = await fetchJson(`${origin}/v1/runs/${childRunId}`);
      expect(childRun.status).toBe(200);
      expect(childRun.body).toMatchObject({
        status: "SUCCEEDED",
        evaluationRunId,
      });
      expect(
        (childRun.body as { restrictPersistentMemory?: boolean })
          .restrictPersistentMemory,
      ).toBeUndefined();

      const runs = new PostgresRunRepository(database);
      const persisted = await runs.findRunById(childRunId);
      expect(persisted?.restrictPersistentMemory).toBe(false);
      expect(persisted?.evaluationRunId).toBe(evaluationRunId);

      const seeded = await ctx.memoryRepository.getRecord(
        namespaceId,
        "greeting",
      );
      expect(seeded?.value).toEqual({ text: "seeded" });
      expect(seeded?.revision).toBe(1);
    } finally {
      await ctx.shutdown();
    }
  });
});

interface MemoryEchoStack {
  readonly origin: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly namespaceId: MemoryNamespaceId;
  readonly memoryRepository: PostgresMemoryNamespaceRepository;
  readonly shutdown: () => Promise<void>;
}

async function startMemoryEchoStack(
  database: Database,
  databaseUrl: string,
  valkey: ValkeyTestContext,
): Promise<MemoryEchoStack> {
  const trustedRuntimeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "osva-playground-memory-"),
  );
  await fs.copyFile(
    path.join(FIXTURE_DIR, "memory-echo-agent.ts"),
    path.join(trustedRuntimeRoot, "memory-echo-agent.ts"),
  );
  const integrity = sha256IntegrityOf(
    await fs.readFile(path.join(trustedRuntimeRoot, "memory-echo-agent.ts")),
  );

  const web = createWebProcess(
    withTestAuthEnv({
      OSVA_DATABASE_URL: databaseUrl,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
    }),
  );
  const worker = createWorkerProcess({
    OSVA_DATABASE_URL: databaseUrl,
    OSVA_VALKEY_URL: valkey.url,
    OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
  });
  const inspector = new BullMqJobQueue({ url: valkey.url });
  const memoryRepository = new PostgresMemoryNamespaceRepository(database);

  const port = await web.listen();
  await worker.start();
  const origin = `http://127.0.0.1:${String(port)}`;

  const namespace = await fetchJson(`${origin}/v1/memory/namespaces`, {
    method: "POST",
    body: { key: "store", name: "Store" },
  });
  expect(namespace.status).toBe(201);
  const namespaceId = (namespace.body as { id: MemoryNamespaceId }).id;

  await memoryRepository.setRecord({
    namespaceId,
    key: "greeting",
    value: { text: "seeded" },
    updatedAt: NOW,
  });

  const agent = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: { key: "memory-echo-agent", name: "Memory Echo Agent" },
  });
  expect(agent.status).toBe(201);
  const agentId = (agent.body as { id: string }).id;

  const agentVersion = await fetchJson(
    `${origin}/v1/agents/${agentId}/versions`,
    {
      method: "POST",
      body: {
        manifest: {
          schemaVersion: "1",
          key: "memory-echo-agent",
          name: "Memory Echo Agent",
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: "memory-echo-agent.ts",
            integrity,
          },
          input: { schema: {} },
          output: { schema: {} },
          execution: { timeoutMs: 8_000, maxAttempts: 1 },
          capabilities: { model: false, tools: [] },
          memory: {
            store: { namespaceId, access: "READ_WRITE" },
          },
        },
      },
    },
  );
  expect(agentVersion.status).toBe(201);
  const agentVersionId = (agentVersion.body as { id: string }).id;

  return {
    origin,
    agentId,
    agentVersionId,
    namespaceId,
    memoryRepository,
    shutdown: async () => {
      await worker.stop();
      await inspector.shutdown();
      await web.stop();
    },
  };
}

async function waitForRunTerminal(origin: string, runId: RunId): Promise<void> {
  await waitUntil(async () => {
    const run = await fetchJson(`${origin}/v1/runs/${runId}`);
    const status = (run.body as { status?: string }).status;
    return (
      run.status === 200 &&
      (status === "SUCCEEDED" ||
        status === "FAILED" ||
        status === "TIMED_OUT" ||
        status === "CANCELLED")
    );
  });
  const run = await fetchJson(`${origin}/v1/runs/${runId}`);
  expect((run.body as { status?: string }).status).toBe("SUCCEEDED");
}

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await delay(50);
  }
  throw new Error("Timed out waiting for playground memory integration.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
