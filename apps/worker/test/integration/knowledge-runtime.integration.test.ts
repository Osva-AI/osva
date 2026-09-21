import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { KnowledgeIndexId, WorkspaceId } from "@osva/contracts";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";

import {
  createKnowledgeIntegrationStack,
  integrationControlPlaneScope,
  TEST_EMBEDDING_DEFAULTS,
  uploadTextArtifact,
} from "../../../../apps/knowledge-worker/test/integration/knowledge-stack.js";
import { createWebProcess } from "../../../../apps/web/src/process.js";
import { createWorkerProcess } from "../../src/process.js";
import {
  bootstrapIntegrationAuth,
  getJson,
  postJson,
} from "./integration-auth.js";
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

const WORKSPACE_ID = "ws-knowledge-runtime" as WorkspaceId;
const NOW = new Date("2026-02-15T12:00:00.000Z");
const MARKER = "OSVA_STAGE35_RUNTIME_KB_MARKER_ALPHA";
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

describe("knowledge runtime end-to-end", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;
  let artifactRoot: string;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    artifactRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-knowledge-runtime-artifacts-"),
    );
  });

  afterAll(async () => {
    await database?.close();
    await stopPostgresForTests(postgres);
    await stopValkeyForTests(valkey);
    await fs.rm(artifactRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await bootstrapIntegrationAuth(
      database,
      WORKSPACE_ID,
      NOW,
      "Knowledge Runtime",
    );
  });

  it("ingests READY knowledge and returns hits through trusted context.knowledge.search", async () => {
    const stack = await createKnowledgeIntegrationStack(database, {
      now: NOW,
      embeddingDefaults: TEST_EMBEDDING_DEFAULTS,
    });
    const sourceBody = `Handbook\n\n${MARKER}\nRefund within thirty days.`;
    const sourceArtifact = await uploadTextArtifact(
      stack,
      WORKSPACE_ID,
      "handbook.txt",
      sourceBody,
    );
    const source = await stack.knowledgeApp.createSource.execute(
      integrationControlPlaneScope(WORKSPACE_ID),
      {
        workspaceId: WORKSPACE_ID,
        key: "handbook",
        name: "Handbook",
        artifactId: sourceArtifact.id,
        attributes: {},
      },
    );
    const index = await stack.knowledgeApp.createIndex.execute(
      integrationControlPlaneScope(WORKSPACE_ID),
      {
        workspaceId: WORKSPACE_ID,
        knowledgeSourceId: source.id,
      },
    );
    await stack.ingestion.processIndex(index.id);
    const ready = await stack.knowledge.findIndexById(index.id);
    expect(ready?.status).toBe("READY");

    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-knowledge-runtime-ts-"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, "knowledge-search-agent.ts"),
      path.join(trustedRuntimeRoot, "knowledge-search-agent.ts"),
    );
    const integrity = sha256IntegrityOf(
      await fs.readFile(
        path.join(trustedRuntimeRoot, "knowledge-search-agent.ts"),
      ),
    );

    const env = {
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      OSVA_ARTIFACT_FILESYSTEM_ROOT: artifactRoot,
      NODE_ENV: "test",
      OSVA_KNOWLEDGE_EMBEDDING_DIMENSIONS: String(
        TEST_EMBEDDING_DEFAULTS.dimensions,
      ),
      OSVA_KNOWLEDGE_EMBEDDING_MODEL: TEST_EMBEDDING_DEFAULTS.model,
    };

    const web = createWebProcess(env);
    const worker = createWorkerProcess(env);
    const inspector = new BullMqJobQueue({ url: valkey.url });

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;

      const agent = await postJson(`${origin}/v1/agents`, {
        key: "knowledge-agent",
        name: "Knowledge Agent",
      });
      expect(agent.status).toBe(201);
      const agentId = (agent.body as { id: string }).id;

      const version = await postJson(
        `${origin}/v1/agents/${agentId}/versions`,
        {
          manifest: {
            schemaVersion: "1",
            key: "knowledge-agent",
            name: "Knowledge Agent",
            runtime: {
              type: "TRUSTED_TYPESCRIPT",
              entrypoint: "knowledge-search-agent.ts",
              integrity,
            },
            input: { schema: {} },
            output: { schema: {} },
            execution: { timeoutMs: 30_000, maxAttempts: 1 },
            capabilities: { model: false, tools: [] },
            knowledge: {
              company_docs: {
                knowledgeIndexIds: [index.id as KnowledgeIndexId],
              },
            },
          },
        },
      );
      expect(version.status).toBe(201);
      const agentVersionId = (version.body as { id: string }).id;

      const created = await postJson(`${origin}/v1/runs`, {
        agentId,
        agentVersionId,
        input: { query: MARKER },
      });
      expect(created.status).toBe(201);
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitUntil(async () => {
        const run = await getJson(`${origin}/v1/runs/${runId}`);
        return (
          run.status === 200 &&
          (run.body as { status?: string }).status === "SUCCEEDED"
        );
      });

      const attempt = await getJson(
        `${origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.status).toBe(200);
      const output = (attempt.body as { output?: Record<string, unknown> })
        .output;
      expect(output?.hitCount).toBeGreaterThan(0);
      expect(String(output?.firstText)).toContain(MARKER);
      expect(output?.indexId).toBe(index.id);

      expect(await inspector.countActiveJobs()).toBe(0);
    } finally {
      await worker.stop();
      await inspector.shutdown();
      await web.stop();
    }
  });
});

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for knowledge runtime execution.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
