import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { BullMqJobQueue } from "@osva/adapters-bullmq";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";
import type { WorkspaceId } from "@osva-ai/contracts";
import { TEST_EMBEDDING_DEFAULTS } from "../../../../apps/knowledge-worker/test/integration/knowledge-stack.js";
import { createWebProcess } from "../../../../apps/web/src/process.js";
import { createWorkerProcess } from "../../../../apps/worker/src/process.js";
import { createWorkflowOrchestratorProcess } from "../../../../apps/workflow-orchestrator/src/process.js";
import { bootstrapIntegrationAuth } from "../../../../apps/worker/test/integration/integration-auth.js";
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

import type { FakeCanonicalModelServer } from "./fake-canonical-model-server.js";
import { startFakeCanonicalModelServer } from "./fake-canonical-model-server.js";
import { resetDeterministicNpmCallCounts } from "./fake-npm-upstream.js";
import {
  deployForIntegration,
  seedCanonicalPlatform,
  seedKnowledgeIndex,
  type CanonicalSeedResult,
} from "./seed-canonical.js";

export interface CanonicalInfra {
  readonly postgres: PostgresTestContext;
  readonly valkey: ValkeyTestContext;
  readonly database: Database;
}

export interface CanonicalStack {
  readonly workspaceId: WorkspaceId;
  readonly origin: string;
  readonly database: Database;
  readonly queue: BullMqJobQueue;
  readonly artifactRoot: string;
  readonly trustedRuntimeRoot: string;
  readonly fakeModel: FakeCanonicalModelServer;
  readonly seed: CanonicalSeedResult;
  readonly web: ReturnType<typeof createWebProcess>;
  readonly worker: ReturnType<typeof createWorkerProcess>;
  tickOrchestrator(): Promise<void>;
  replaceOrchestrator(): Promise<void>;
  stopProcesses(): Promise<void>;
}

export interface StartCanonicalStackOptions {
  readonly now?: Date;
  readonly reportMarkdown?: string;
}

const DEFAULT_NOW = new Date("2026-03-15T12:00:00.000Z");

export async function startCanonicalInfra(): Promise<CanonicalInfra> {
  const postgres = await startPostgresForTests();
  const valkey = await startValkeyForTests();
  const database = createDatabase({
    connectionString: postgres.connectionString,
    max: 10,
    connectTimeoutSeconds: 10,
  });
  await migrateDatabase(database);
  return { postgres, valkey, database };
}

export async function stopCanonicalInfra(
  infra: CanonicalInfra | undefined,
): Promise<void> {
  if (infra === undefined) {
    return;
  }
  await infra.database.close();
  await stopPostgresForTests(infra.postgres);
  await stopValkeyForTests(infra.valkey);
}

export async function startCanonicalStack(
  infra: CanonicalInfra,
  options: StartCanonicalStackOptions = {},
): Promise<CanonicalStack> {
  const now = options.now ?? DEFAULT_NOW;
  const workspaceId = `ws-canonical-m6-${randomUUID()}` as WorkspaceId;

  await resetStage0Tables(infra.database);
  await bootstrapIntegrationAuth(
    infra.database,
    workspaceId,
    now,
    "Canonical M6",
  );

  const knowledgeIndexId = await seedKnowledgeIndex(
    infra.database,
    workspaceId,
    now,
  );

  const artifactRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "osva-canonical-m6-artifacts-"),
  );
  const trustedRuntimeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "osva-canonical-m6-runtime-"),
  );
  const deployed = await deployForIntegration(trustedRuntimeRoot);
  resetDeterministicNpmCallCounts();

  const fakeModel = await startFakeCanonicalModelServer({
    reportMarkdown: options.reportMarkdown,
  });

  const queue = new BullMqJobQueue({ url: infra.valkey.url });
  const sharedEnv = {
    OSVA_DATABASE_URL: infra.postgres.connectionString,
    OSVA_VALKEY_URL: infra.valkey.url,
    OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
    OSVA_ARTIFACT_FILESYSTEM_ROOT: artifactRoot,
    OSVA_MCP_STDIO_CONNECTORS_ENABLED: "true",
    OSVA_ALLOW_DETERMINISTIC_EMBEDDINGS: "true",
    NODE_ENV: "test",
    OSVA_KNOWLEDGE_EMBEDDING_DIMENSIONS: String(
      TEST_EMBEDDING_DEFAULTS.dimensions,
    ),
    OSVA_KNOWLEDGE_EMBEDDING_MODEL: TEST_EMBEDDING_DEFAULTS.model,
  };

  const web = createWebProcess(
    {
      ...sharedEnv,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
    },
    (connectionString) => createDatabase({ connectionString, max: 5 }),
    () => queue,
  );
  const port = await web.listen();
  const origin = `http://127.0.0.1:${String(port)}`;

  const worker = createWorkerProcess(
    sharedEnv,
    (connectionString) => createDatabase({ connectionString, max: 5 }),
    {
      queueFactory: () => queue,
      openai: {
        apiKey: "test-key",
        baseURL: fakeModel.origin,
        maxRetries: 0,
      },
    },
  );

  const orchestratorRef: {
    current: ReturnType<typeof createWorkflowOrchestratorProcess>;
  } = {
    current: createWorkflowOrchestratorProcess(
      {
        OSVA_DATABASE_URL: infra.postgres.connectionString,
        OSVA_VALKEY_URL: infra.valkey.url,
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      { queueFactory: () => queue },
    ),
  };

  await worker.start();

  const seed = await seedCanonicalPlatform({
    origin,
    workspaceId,
    trustedRuntimeRoot,
    deployed,
    knowledgeIndexId,
  });

  return {
    workspaceId,
    origin,
    database: infra.database,
    queue,
    artifactRoot,
    trustedRuntimeRoot,
    fakeModel,
    seed,
    web,
    worker,
    async tickOrchestrator() {
      await orchestratorRef.current.tickOnce();
    },
    async replaceOrchestrator() {
      // Do not call stop() on the prior orchestrator: its onClose shuts down the
      // shared BullMqJobQueue instance while the worker is still consuming jobs.
      orchestratorRef.current = createWorkflowOrchestratorProcess(
        {
          OSVA_DATABASE_URL: infra.postgres.connectionString,
          OSVA_VALKEY_URL: infra.valkey.url,
        },
        (connectionString) => createDatabase({ connectionString, max: 5 }),
        { queueFactory: () => queue },
      );
    },
    async stopProcesses() {
      await worker.stop();
      await orchestratorRef.current.stop();
      await queue.shutdown();
      await web.stop();
    },
  };
}

export async function stopCanonicalStack(
  stack: CanonicalStack | undefined,
): Promise<void> {
  if (stack === undefined) {
    return;
  }
  await stack.stopProcesses();
  await stack.fakeModel.close();
  await fs.rm(stack.artifactRoot, { recursive: true, force: true });
  await fs.rm(stack.trustedRuntimeRoot, { recursive: true, force: true });
}

export async function withCanonicalStack<T>(
  infra: CanonicalInfra,
  options: StartCanonicalStackOptions,
  run: (stack: CanonicalStack) => Promise<T>,
): Promise<T> {
  const stack = await startCanonicalStack(infra, options);
  try {
    return await run(stack);
  } finally {
    await stopCanonicalStack(stack);
  }
}

export async function waitUntil(
  check: () => Promise<boolean>,
  timeoutMs = 240_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await delay(25);
  }
  throw new Error("Timed out waiting for canonical workflow condition.");
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
