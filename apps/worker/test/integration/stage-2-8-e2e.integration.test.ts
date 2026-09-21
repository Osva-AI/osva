import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MemoryNamespaceId, WorkspaceId } from "@osva/contracts";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import {
  createDatabase,
  migrateDatabase,
  PostgresMemoryNamespaceRepository,
  type Database,
} from "@osva/db";

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

const WORKSPACE_ID = "ws-stage-28" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

describe("Stage 2.8 memory and evaluation end-to-end", () => {
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

  it("runs evaluation child runs with memory reads, blocked writes, and PASS/FAIL outcomes", async () => {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-e2e-stage-28-"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, "memory-echo-agent.ts"),
      path.join(trustedRuntimeRoot, "memory-echo-agent.ts"),
    );
    const integrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, "memory-echo-agent.ts")),
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
    const memoryRepository = new PostgresMemoryNamespaceRepository(database);

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;

      const namespace = await fetchJson(`${origin}/v1/memory/namespaces`, {
        method: "POST",
        body: {
          key: "store",
          name: "Store",
        },
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
        body: {
          key: "memory-echo-agent",
          name: "Memory Echo Agent",
        },
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
                store: {
                  namespaceId,
                  access: "READ_WRITE",
                },
              },
            },
          },
        },
      );
      expect(agentVersion.status).toBe(201);
      const agentVersionId = (agentVersion.body as { id: string }).id;

      const passOutput = {
        echoed: { memoryKey: "greeting" },
        memoryValue: { text: "seeded" },
        memoryRevision: 1,
        writeBlocked: true,
        writeErrorCode: "MEMORY_PERMISSION_DENIED",
      };
      const suite = await fetchJson(`${origin}/v1/evaluation-suites`, {
        method: "POST",
        body: {
          key: "memory-smoke",
          name: "Memory Smoke",
        },
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
                key: "beta-fail",
                input: { memoryKey: "missing" },
                evaluator: {
                  type: "JSON_EXACT_MATCH",
                  expected: { wrong: true },
                },
              },
              {
                key: "alpha-pass",
                input: { memoryKey: "greeting" },
                evaluator: {
                  type: "JSON_EXACT_MATCH",
                  expected: passOutput,
                },
              },
              {
                key: "gamma-fail",
                input: { memoryKey: "greeting" },
                evaluator: {
                  type: "JSON_EXACT_MATCH",
                  expected: { wrong: true },
                },
              },
            ],
          },
        },
      );
      expect(suiteVersion.status).toBe(201);
      const evaluationSuiteVersionId = (suiteVersion.body as { id: string }).id;
      expect(
        (suiteVersion.body as { cases: Array<{ key: string }> }).cases.map(
          (evaluationCase) => evaluationCase.key,
        ),
      ).toEqual(["alpha-pass", "beta-fail", "gamma-fail"]);

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

      const detail = await fetchJson(
        `${origin}/v1/evaluation-runs/${evaluationRunId}`,
      );
      expect(detail.body).toMatchObject({
        id: evaluationRunId,
        status: "COMPLETED",
        summary: {
          totalCases: 3,
          completedCases: 3,
          passedCases: 1,
          failedCases: 2,
          errorCases: 0,
          pendingCases: 0,
          runningCases: 0,
          passRate: 1 / 3,
          inputTokens: 0,
          outputTokens: 0,
          pricedCostUsdMicros: 0,
          unpricedModelCalls: 0,
        },
      });

      const caseResults = await fetchJson(
        `${origin}/v1/evaluation-runs/${evaluationRunId}/case-results`,
      );
      expect(caseResults.status).toBe(200);
      const items = (
        caseResults.body as {
          items: Array<{
            outcome: string;
            runId: string;
            evaluatorResults: Record<string, unknown>;
          }>;
        }
      ).items;
      expect(items).toHaveLength(3);

      const passCase = items.find((item) => item.outcome === "PASS");
      const failCases = items.filter((item) => item.outcome === "FAIL");
      expect(passCase).toBeDefined();
      expect(failCases).toHaveLength(2);
      expect(passCase?.evaluatorResults).toMatchObject({
        type: "JSON_EXACT_MATCH",
        passed: true,
      });

      for (const item of items) {
        expect(item.runId.length).toBeGreaterThan(0);

        const run = await fetchJson(`${origin}/v1/runs/${item.runId}`);
        expect(run.status).toBe(200);
        expect((run.body as { status?: string }).status).toBe("SUCCEEDED");

        const attempts = await fetchJson(
          `${origin}/v1/runs/${item.runId}/attempts`,
        );
        expect(attempts.status).toBe(200);
        const attemptList = (
          attempts.body as { attempts: Array<{ id: string; status: string }> }
        ).attempts;
        expect(attemptList).toHaveLength(1);

        const attempt = await fetchJson(
          `${origin}/v1/runs/${item.runId}/attempts/${attemptList[0]!.id}`,
        );
        expect(attempt.body).toMatchObject({
          status: "SUCCEEDED",
          output: {
            writeBlocked: true,
            writeErrorCode: "MEMORY_PERMISSION_DENIED",
          },
        });
      }

      const seeded = await memoryRepository.getRecord(namespaceId, "greeting");
      expect(seeded?.value).toEqual({ text: "seeded" });
      expect(seeded?.revision).toBe(1);
      expect(await inspector.countActiveJobs()).toBe(0);
    } finally {
      await worker.stop();
      await inspector.shutdown();
      await web.stop();
    }
  });
});

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await delay(50);
  }
  throw new Error("Timed out waiting for Stage 2.8 evaluation execution.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
