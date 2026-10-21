import fs from "node:fs/promises";
import { withTestAuthEnv } from "../../../../packages/db/test/integration/web-auth-env.js";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  KnowledgeIndexId,
  MemoryNamespaceId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";
import { PostgresMemoryNamespaceRepository } from "@osva/db";
import { MemoryNamespace } from "@osva/domain";

import { startFakeOpenAIResponsesServer } from "../../../../adapters/model-openai/test/fake-openai-server.js";
import {
  createKnowledgeIntegrationStack,
  integrationControlPlaneScope,
  uploadTextArtifact,
} from "../../../../apps/knowledge-worker/test/integration/knowledge-stack.js";
import { createWebProcess } from "../../../web/src/process.js";
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

const WORKSPACE_ID = "ws-declarative-knowledge" as WorkspaceId;
const NOW = new Date("2026-03-01T12:00:00.000Z");
const INTEGRATION_EMBEDDING_DEFAULTS = {
  provider: "DETERMINISTIC" as const,
  model: "deterministic-v1",
  dimensions: 384,
};
const KNOWLEDGE_PROBE_MARKER = "OSVA_DECLARATIVE_KB_PROBE_MARKER";
const MEMORY_PROBE_KEY = "declarative-memory-probe";
const MEMORY_PROBE_VALUE = "memory-boundary-secret";

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

const OUTPUT_SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
};

describe("declarative knowledge runtime end-to-end", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;
  let artifactRoot: string;
  let trustedRuntimeRoot: string;

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
      path.join(os.tmpdir(), "osva-declarative-knowledge-artifacts-"),
    );
    trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-declarative-knowledge-trusted-"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, "echo-agent.ts"),
      path.join(trustedRuntimeRoot, "echo-agent.ts"),
    );
  }, 180_000);

  afterAll(async () => {
    await database?.close();
    await stopPostgresForTests(postgres);
    await stopValkeyForTests(valkey);
    await fs.rm(artifactRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await bootstrapIntegrationAuth(database, WORKSPACE_ID, NOW);
  });

  it("prefetches bound READY knowledge into the model request and succeeds", async () => {
    const knowledgeStack = await createKnowledgeIntegrationStack(database, {
      now: NOW,
      embeddingDefaults: INTEGRATION_EMBEDDING_DEFAULTS,
      artifactRoot,
    });
    const readyIndexId = await seedReadyKnowledgeIndex(
      knowledgeStack,
      WORKSPACE_ID,
      KNOWLEDGE_PROBE_MARKER,
    );

    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await startDeclarativeKnowledgeStack(
      postgres,
      valkey,
      fakeOpenAI.origin,
      artifactRoot,
      trustedRuntimeRoot,
    );

    try {
      const { modelProfileVersionId, agentId } = await seedModelProfile(
        stack.origin,
      );
      const agentVersionId = await createDeclarativeAgentVersionWithKnowledge(
        stack.origin,
        {
          agentId,
          modelProfileVersionId,
          knowledgeIndexIds: [readyIndexId],
        },
      );

      const created = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId,
          agentVersionId,
          input: { task: "declarative-knowledge-probe" },
        },
      });
      expect(created.status).toBe(201);
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });

      const attempt = await fetchJson(
        `${stack.origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: { answer: "declarative-knowledge-ok" },
      });

      const chatRequest = fakeOpenAI.requests.find((request) =>
        request.url.includes("/chat/completions"),
      );
      expect(chatRequest).toBeDefined();
      const body = chatRequest?.body as {
        messages?: Array<{ content?: string }>;
      };
      const userContent = (body.messages ?? [])
        .filter((message) => typeof message.content === "string")
        .map((message) => message.content)
        .join("\n");
      expect(userContent).toContain(KNOWLEDGE_PROBE_MARKER);
      expect(userContent).toContain("untrusted retrieved data");
      expect(userContent.length).toBeLessThan(20_000);
    } finally {
      await stack.stop();
      await fakeOpenAI.close();
    }
  }, 120_000);

  it("does not inject knowledge when the agent has no knowledge binding", async () => {
    const knowledgeStack = await createKnowledgeIntegrationStack(database, {
      now: NOW,
      embeddingDefaults: INTEGRATION_EMBEDDING_DEFAULTS,
      artifactRoot,
    });
    await seedReadyKnowledgeIndex(
      knowledgeStack,
      WORKSPACE_ID,
      KNOWLEDGE_PROBE_MARKER,
    );

    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await startDeclarativeKnowledgeStack(
      postgres,
      valkey,
      fakeOpenAI.origin,
      artifactRoot,
      trustedRuntimeRoot,
    );

    try {
      const { modelProfileVersionId, agentId } = await seedModelProfile(
        stack.origin,
      );
      const agentVersionId = await createDeclarativeAgentVersionWithKnowledge(
        stack.origin,
        {
          agentId,
          modelProfileVersionId,
          knowledgeIndexIds: [],
        },
      );

      const created = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId,
          agentVersionId,
          input: { task: "declarative-knowledge-probe" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });

      const attempt = await fetchJson(
        `${stack.origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: { answer: "declarative-knowledge-miss" },
      });
    } finally {
      await stack.stop();
      await fakeOpenAI.close();
    }
  }, 120_000);

  it("rejects binding a non-READY knowledge index when publishing an AgentVersion", async () => {
    const knowledgeStack = await createKnowledgeIntegrationStack(database, {
      now: NOW,
      embeddingDefaults: INTEGRATION_EMBEDDING_DEFAULTS,
      artifactRoot,
    });
    const sourceArtifact = await uploadTextArtifact(
      knowledgeStack,
      WORKSPACE_ID,
      "pending.txt",
      `Pending source ${KNOWLEDGE_PROBE_MARKER}`,
    );
    const source = await knowledgeStack.knowledgeApp.createSource.execute(
      integrationControlPlaneScope(WORKSPACE_ID),
      {
        workspaceId: WORKSPACE_ID,
        key: "pending",
        name: "Pending",
        artifactId: sourceArtifact.id,
        attributes: {},
      },
    );
    const pendingIndex = await knowledgeStack.knowledgeApp.createIndex.execute(
      integrationControlPlaneScope(WORKSPACE_ID),
      {
        workspaceId: WORKSPACE_ID,
        knowledgeSourceId: source.id,
      },
    );
    expect(pendingIndex.status).not.toBe("READY");

    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await startDeclarativeKnowledgeStack(
      postgres,
      valkey,
      fakeOpenAI.origin,
      artifactRoot,
      trustedRuntimeRoot,
    );

    try {
      const { modelProfileVersionId, agentId } = await seedModelProfile(
        stack.origin,
      );
      const versionResponse = await fetchJson(
        `${stack.origin}/v1/agents/${agentId}/versions`,
        {
          method: "POST",
          body: {
            manifest: {
              schemaVersion: "1",
              key: "declarative-knowledge-agent",
              name: "Declarative Knowledge",
              runtime: {
                type: "DECLARATIVE",
                config: {
                  configVersion: "1",
                  instructions: "Answer from evidence when present.",
                  modelBinding: "primary",
                  allowedToolBindings: [],
                  maxModelInvocations: 2,
                  maxToolInvocations: 0,
                },
              },
              input: { schema: { type: "object" } },
              output: { schema: OUTPUT_SCHEMA },
              execution: { timeoutMs: 15_000, maxAttempts: 1 },
              capabilities: { model: true, tools: [] },
              models: {
                primary: { modelProfileVersionId },
              },
              knowledge: {
                company_docs: {
                  knowledgeIndexIds: [pendingIndex.id],
                },
              },
            },
          },
        },
      );
      expect(versionResponse.status).toBe(400);
      expect(versionResponse.body).toEqual({ status: "invalid_request" });
    } finally {
      await stack.stop();
      await fakeOpenAI.close();
    }
  }, 120_000);

  it("fails with sanitized error when a READY index becomes unavailable before execution", async () => {
    const knowledgeStack = await createKnowledgeIntegrationStack(database, {
      now: NOW,
      embeddingDefaults: INTEGRATION_EMBEDDING_DEFAULTS,
      artifactRoot,
    });
    const readyIndexId = await seedReadyKnowledgeIndex(
      knowledgeStack,
      WORKSPACE_ID,
      KNOWLEDGE_PROBE_MARKER,
    );

    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await startDeclarativeKnowledgeStack(
      postgres,
      valkey,
      fakeOpenAI.origin,
      artifactRoot,
      trustedRuntimeRoot,
    );

    try {
      const { modelProfileVersionId, agentId } = await seedModelProfile(
        stack.origin,
      );
      const agentVersionId = await createDeclarativeAgentVersionWithKnowledge(
        stack.origin,
        {
          agentId,
          modelProfileVersionId,
          knowledgeIndexIds: [readyIndexId],
        },
      );

      await database.sql`
          update knowledge_indexes
          set status = 'FAILED', updated_at = ${NOW.toISOString()}
          where id = ${readyIndexId}
        `;

      const created = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId,
          agentVersionId,
          input: { task: "declarative-knowledge-probe" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        const status = (run.body as { status?: string }).status;
        return status === "FAILED" || status === "SUCCEEDED";
      });

      const attempt = await fetchJson(
        `${stack.origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "FAILED",
        error: { code: "KNOWLEDGE_UNAVAILABLE" },
      });
      const message = (attempt.body as { error?: { message?: string } }).error
        ?.message;
      expect(message).toBeDefined();
      expect(message?.toLowerCase()).not.toContain("postgres");
    } finally {
      await stack.stop();
      await fakeOpenAI.close();
    }
  }, 120_000);

  it("reads bound memory snapshots only and does not persist writes for READ_WRITE bindings", async () => {
    const memoryRepository = new PostgresMemoryNamespaceRepository(database);
    const boundNamespace = MemoryNamespace.create({
      id: "mn-bound-declarative" as MemoryNamespaceId,
      workspaceId: WORKSPACE_ID,
      key: "bound",
      name: "Bound",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const otherNamespace = MemoryNamespace.create({
      id: "mn-other-declarative" as MemoryNamespaceId,
      workspaceId: WORKSPACE_ID,
      key: "other",
      name: "Other",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await memoryRepository.saveNamespace(boundNamespace);
    await memoryRepository.saveNamespace(otherNamespace);
    await memoryRepository.setRecord({
      namespaceId: boundNamespace.id,
      key: MEMORY_PROBE_KEY,
      value: { text: MEMORY_PROBE_VALUE },
      updatedAt: NOW,
    });
    await memoryRepository.setRecord({
      namespaceId: otherNamespace.id,
      key: MEMORY_PROBE_KEY,
      value: { text: "other-namespace-secret" },
      updatedAt: NOW,
    });

    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await startDeclarativeKnowledgeStack(
      postgres,
      valkey,
      fakeOpenAI.origin,
      artifactRoot,
      trustedRuntimeRoot,
    );

    try {
      const { modelProfileVersionId, agentId } = await seedModelProfile(
        stack.origin,
      );
      const agentVersionId = await createDeclarativeAgentVersionWithMemory(
        stack.origin,
        {
          agentId,
          modelProfileVersionId,
          memoryBindings: {
            notes: {
              namespaceId: boundNamespace.id as MemoryNamespaceId,
              access: "READ_WRITE",
            },
          },
        },
      );

      const created = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId,
          agentVersionId,
          input: { task: "declarative-memory-probe" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });

      const recordAfter = await memoryRepository.getRecord(
        boundNamespace.id,
        MEMORY_PROBE_KEY,
      );
      expect(recordAfter?.revision).toBe(1);

      const chatRequest = fakeOpenAI.requests.find((request) =>
        request.url.includes("/chat/completions"),
      );
      const body = chatRequest?.body as {
        messages?: Array<{ content?: string }>;
      };
      const userContent = (body?.messages ?? [])
        .map((message) => message.content)
        .filter((content): content is string => typeof content === "string")
        .join("\n");
      expect(userContent).toContain(MEMORY_PROBE_VALUE);
      expect(userContent).not.toContain("other-namespace-secret");
      expect(userContent.length).toBeLessThan(12_000);

      const attempt = await fetchJson(
        `${stack.origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({ status: "SUCCEEDED" });
    } finally {
      await stack.stop();
      await fakeOpenAI.close();
    }
  }, 120_000);
});

async function seedReadyKnowledgeIndex(
  knowledgeStack: Awaited<ReturnType<typeof createKnowledgeIntegrationStack>>,
  workspaceId: WorkspaceId,
  marker: string,
): Promise<KnowledgeIndexId> {
  const sourceBody = `Policy handbook\n\n${marker}\nRefund within thirty days.`;
  const sourceArtifact = await uploadTextArtifact(
    knowledgeStack,
    workspaceId,
    "handbook.txt",
    sourceBody,
  );
  const source = await knowledgeStack.knowledgeApp.createSource.execute(
    integrationControlPlaneScope(workspaceId),
    {
      workspaceId,
      key: "handbook",
      name: "Handbook",
      artifactId: sourceArtifact.id,
      attributes: {},
    },
  );
  const index = await knowledgeStack.knowledgeApp.createIndex.execute(
    integrationControlPlaneScope(workspaceId),
    {
      workspaceId,
      knowledgeSourceId: source.id,
    },
  );
  await knowledgeStack.ingestion.processIndex(index.id);
  const ready = await knowledgeStack.knowledge.findIndexById(index.id);
  expect(ready?.status).toBe("READY");
  return index.id as KnowledgeIndexId;
}

async function startDeclarativeKnowledgeStack(
  postgres: PostgresTestContext,
  valkey: ValkeyTestContext,
  fakeOpenAiOrigin: string,
  artifactFilesystemRoot: string,
  trustedRuntimeRoot: string,
) {
  const env = withTestAuthEnv({
    OSVA_DATABASE_URL: postgres.connectionString,
    OSVA_VALKEY_URL: valkey.url,
    OSVA_WEB_HOST: "127.0.0.1",
    OSVA_WEB_PORT: "0",
    OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
    OSVA_ARTIFACT_FILESYSTEM_ROOT: artifactFilesystemRoot,
    NODE_ENV: "test",
    OSVA_KNOWLEDGE_EMBEDDING_PROVIDER: INTEGRATION_EMBEDDING_DEFAULTS.provider,
    OSVA_KNOWLEDGE_EMBEDDING_DIMENSIONS: String(
      INTEGRATION_EMBEDDING_DEFAULTS.dimensions,
    ),
    OSVA_KNOWLEDGE_EMBEDDING_MODEL: INTEGRATION_EMBEDDING_DEFAULTS.model,
  });

  const web = createWebProcess(env);
  const worker = createWorkerProcess(
    env,
    (connectionString) => createDatabase({ connectionString, max: 5 }),
    {
      openai: {
        apiKey: "test-key",
        baseURL: fakeOpenAiOrigin,
        maxRetries: 0,
      },
    },
  );

  const port = await web.listen();
  await worker.start();
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    async stop() {
      await worker.stop();
      await web.stop();
    },
  };
}

async function seedModelProfile(origin: string) {
  const profile = await fetchJson(`${origin}/v1/model-profiles`, {
    method: "POST",
    body: { key: "primary", name: "Primary" },
  });
  expect(profile.status).toBe(201);
  const modelProfileId = (profile.body as { id: string }).id;

  const version = await fetchJson(
    `${origin}/v1/model-profiles/${modelProfileId}/versions`,
    {
      method: "POST",
      body: {
        provider: "OPENAI",
        model: "gpt-test-snapshot",
        pricing: {
          currency: "USD",
          inputUsdMicrosPerMillionTokens: 1_000_000,
          outputUsdMicrosPerMillionTokens: 2_000_000,
        },
      },
    },
  );
  expect(version.status).toBe(201);
  const modelProfileVersionId = (version.body as { id: string }).id;

  const agent = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: { key: "declarative-knowledge-agent", name: "Declarative Knowledge" },
  });
  expect(agent.status).toBe(201);

  return {
    modelProfileVersionId,
    agentId: (agent.body as { id: string }).id,
  };
}

async function createDeclarativeAgentVersionWithKnowledge(
  origin: string,
  input: {
    readonly agentId: string;
    readonly modelProfileVersionId: string;
    readonly knowledgeIndexIds: readonly KnowledgeIndexId[];
  },
): Promise<string> {
  const knowledgeBlock =
    input.knowledgeIndexIds.length === 0
      ? {}
      : {
          knowledge: {
            company_docs: {
              knowledgeIndexIds: input.knowledgeIndexIds,
            },
          },
        };

  const versionResponse = await fetchJson(
    `${origin}/v1/agents/${input.agentId}/versions`,
    {
      method: "POST",
      body: {
        manifest: {
          schemaVersion: "1",
          key: "declarative-knowledge-agent",
          name: "Declarative Knowledge",
          runtime: {
            type: "DECLARATIVE",
            config: {
              configVersion: "1",
              instructions: "Answer from evidence when present.",
              modelBinding: "primary",
              allowedToolBindings: [],
              maxModelInvocations: 2,
              maxToolInvocations: 0,
            },
          },
          input: { schema: { type: "object" } },
          output: { schema: OUTPUT_SCHEMA },
          execution: { timeoutMs: 15_000, maxAttempts: 1 },
          capabilities: { model: true, tools: [] },
          models: {
            primary: { modelProfileVersionId: input.modelProfileVersionId },
          },
          ...knowledgeBlock,
        },
      },
    },
  );
  expect(versionResponse.status).toBe(201);
  return (versionResponse.body as { id: string }).id;
}

async function createDeclarativeAgentVersionWithMemory(
  origin: string,
  input: {
    readonly agentId: string;
    readonly modelProfileVersionId: string;
    readonly memoryBindings: Record<
      string,
      { namespaceId: MemoryNamespaceId; access: "READ_ONLY" | "READ_WRITE" }
    >;
  },
): Promise<string> {
  const versionResponse = await fetchJson(
    `${origin}/v1/agents/${input.agentId}/versions`,
    {
      method: "POST",
      body: {
        manifest: {
          schemaVersion: "1",
          key: "declarative-knowledge-agent",
          name: "Declarative Knowledge",
          runtime: {
            type: "DECLARATIVE",
            config: {
              configVersion: "1",
              instructions: "Answer ok.",
              modelBinding: "primary",
              allowedToolBindings: [],
              maxModelInvocations: 2,
              maxToolInvocations: 0,
            },
          },
          input: { schema: { type: "object" } },
          output: { schema: OUTPUT_SCHEMA },
          execution: { timeoutMs: 15_000, maxAttempts: 1 },
          capabilities: { model: true, tools: [] },
          models: {
            primary: { modelProfileVersionId: input.modelProfileVersionId },
          },
          memory: input.memoryBindings,
        },
      },
    },
  );
  expect(versionResponse.status).toBe(201);
  return (versionResponse.body as { id: string }).id;
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs = 45_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for condition.");
}
