import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { BatchInferenceItemId, WorkspaceId } from "@osva-ai/contracts";
import { COMMUNITY_EDITION_ROLES } from "@osva-ai/contracts";
import {
  createDatabase,
  migrateDatabase,
  PostgresApiKeyRepository,
  PostgresBatchInferenceJobRepository,
  PostgresWorkspaceBatchInferencePolicyRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import { CreateApiKey, Workspace } from "@osva/domain";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import { createBatchInferenceWorkerBundle } from "../../src/create-batch-inference-worker.js";
import { ProcessEnvSecretResolver } from "@osva/adapters-runtime-http";

import { startFakeOpenAiBatchServer } from "../../../../adapters/model-openai/test/fake-openai-batch-server.js";
import { startFakeAnthropicBatchServer } from "../../../../adapters/model-anthropic/test/fake-anthropic-batch-server.js";
import { startFakeGeminiBatchServer } from "../../../../adapters/model-gemini/test/fake-gemini-batch-server.js";
import { bootstrapIntegrationAuth, fetchJson } from "./integration-auth.js";
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
import { withTestAuthEnv } from "../../../../packages/db/test/integration/web-auth-env.js";

const WORKSPACE_A = "ws-batch-a" as WorkspaceId;
const WORKSPACE_B = "ws-batch-b" as WorkspaceId;
const NOW = new Date("2026-03-01T12:00:00.000Z");
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

async function prepareTrustedRuntimeRoot(): Promise<string> {
  const trustedRuntimeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "osva-batch-e2e-"),
  );
  await fs.copyFile(
    path.join(FIXTURE_DIR, "model-text-agent.ts"),
    path.join(trustedRuntimeRoot, "model-text-agent.ts"),
  );
  sha256IntegrityOf(
    await fs.readFile(path.join(trustedRuntimeRoot, "model-text-agent.ts")),
  );
  return trustedRuntimeRoot;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithToken(
  url: string,
  token: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  headers.authorization = `Bearer ${token}`;
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: response.status, body: await response.json() };
}

async function mintWorkspaceApiKey(
  db: Database,
  workspaceId: WorkspaceId,
  workspaceName: string,
): Promise<string> {
  const workspaces = new PostgresWorkspaceRepository(db);
  await workspaces.save(
    Workspace.create({
      id: workspaceId,
      name: workspaceName,
      createdAt: NOW,
    }),
  );
  const apiKeys = new PostgresApiKeyRepository(db);
  const deps = {
    apiKeys,
    workspaces,
    clock: { now: () => NOW },
    ids: { createId: () => randomUUID() },
  };
  const createApiKey = new CreateApiKey(deps);
  const created = await createApiKey.execute({
    workspaceId,
    name: `${workspaceName} integration`,
    role: COMMUNITY_EDITION_ROLES.ADMIN,
  });
  if (created.plaintextToken === undefined) {
    throw new Error("api key missing");
  }
  return created.plaintextToken;
}

async function waitForProviderBatchId(
  origin: string,
  jobId: string,
  deadlineMs = 30_000,
): Promise<Record<string, unknown>> {
  const started = Date.now();
  for (;;) {
    const detail = await fetchJson(
      `${origin}/v1/batch-inference-jobs/${jobId}`,
    );
    const job = (detail.body as { job: Record<string, unknown> }).job;
    if (
      typeof job.providerBatchId === "string" &&
      job.providerBatchId.length > 0
    ) {
      return job;
    }
    const status = job.status as string;
    if (
      status === "COMPLETED" ||
      status === "FAILED" ||
      status === "CANCELLED" ||
      status === "EXPIRED"
    ) {
      throw new Error(`job reached ${status} before providerBatchId`);
    }
    if (Date.now() - started > deadlineMs) {
      throw new Error("timeout waiting for providerBatchId");
    }
    await sleep(200);
  }
}

async function waitForJobTerminal(
  origin: string,
  jobId: string,
  deadlineMs = 45_000,
): Promise<Record<string, unknown>> {
  const started = Date.now();
  for (;;) {
    const detail = await fetchJson(
      `${origin}/v1/batch-inference-jobs/${jobId}`,
    );
    const job = (detail.body as { job: Record<string, unknown> }).job;
    const status = job.status as string;
    if (
      status === "COMPLETED" ||
      status === "PARTIALLY_COMPLETED" ||
      status === "FAILED" ||
      status === "CANCELLED" ||
      status === "EXPIRED"
    ) {
      return job;
    }
    if (Date.now() - started > deadlineMs) {
      throw new Error(`timeout waiting for terminal batch job; last=${status}`);
    }
    await sleep(400);
  }
}

describe("batch inference OpenAI vertical slice", () => {
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
    await database?.close();
    await stopPostgresForTests(postgres);
    await stopValkeyForTests(valkey);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await bootstrapIntegrationAuth(database, WORKSPACE_A, NOW, "Batch A");
  });

  async function seedOpenAiBinding(
    origin: string,
    fakeOrigin: string,
  ): Promise<{
    modelProfileVersionId: string;
    providerConnectionVersionId: string;
  }> {
    const connection = await fetchJson(
      `${origin}/v1/model-provider-connections`,
      {
        method: "POST",
        body: {
          key: "openai-batch",
          name: "OpenAI batch",
          provider: "OPENAI",
        },
      },
    );
    expect(connection.status).toBe(201);
    const connectionId = (connection.body as { id: string }).id;
    const connectionVersion = await fetchJson(
      `${origin}/v1/model-provider-connections/${connectionId}/versions`,
      {
        method: "POST",
        body: {
          endpoint: {
            baseUrl: `${fakeOrigin}/v1`,
            allowPrivateNetworks: true,
          },
          credentialRef: { key: "OPENAI_API_KEY" },
        },
      },
    );
    expect(connectionVersion.status).toBe(201);
    const providerConnectionVersionId = (
      connectionVersion.body as { id: string }
    ).id;

    const profile = await fetchJson(`${origin}/v1/model-profiles`, {
      method: "POST",
      body: { key: "batch", name: "Batch model" },
    });
    const modelProfileId = (profile.body as { id: string }).id;
    const version = await fetchJson(
      `${origin}/v1/model-profiles/${modelProfileId}/versions`,
      {
        method: "POST",
        body: {
          provider: "OPENAI",
          model: "gpt-4o-mini",
          modelProviderConnectionVersionId: providerConnectionVersionId,
        },
      },
    );
    expect(version.status).toBe(201);
    return {
      modelProfileVersionId: (version.body as { id: string }).id,
      providerConnectionVersionId,
    };
  }

  async function seedAnthropicBinding(
    origin: string,
    fakeOrigin: string,
  ): Promise<{
    modelProfileVersionId: string;
    providerConnectionVersionId: string;
  }> {
    const connection = await fetchJson(
      `${origin}/v1/model-provider-connections`,
      {
        method: "POST",
        body: {
          key: "anthropic-batch",
          name: "Anthropic batch",
          provider: "ANTHROPIC",
        },
      },
    );
    expect(connection.status).toBe(201);
    const connectionId = (connection.body as { id: string }).id;
    const connectionVersion = await fetchJson(
      `${origin}/v1/model-provider-connections/${connectionId}/versions`,
      {
        method: "POST",
        body: {
          endpoint: {
            baseUrl: fakeOrigin,
            allowPrivateNetworks: true,
          },
          credentialRef: { key: "ANTHROPIC_API_KEY" },
        },
      },
    );
    expect(connectionVersion.status).toBe(201);
    const providerConnectionVersionId = (
      connectionVersion.body as { id: string }
    ).id;
    const profile = await fetchJson(`${origin}/v1/model-profiles`, {
      method: "POST",
      body: { key: "batch-anthropic", name: "Anthropic batch" },
    });
    const modelProfileId = (profile.body as { id: string }).id;
    const version = await fetchJson(
      `${origin}/v1/model-profiles/${modelProfileId}/versions`,
      {
        method: "POST",
        body: {
          provider: "ANTHROPIC",
          model: "claude-3-5-sonnet-20241022",
          modelProviderConnectionVersionId: providerConnectionVersionId,
        },
      },
    );
    expect(version.status).toBe(201);
    return {
      modelProfileVersionId: (version.body as { id: string }).id,
      providerConnectionVersionId,
    };
  }

  async function seedGeminiBinding(
    origin: string,
    fakeOrigin: string,
  ): Promise<{
    modelProfileVersionId: string;
    providerConnectionVersionId: string;
  }> {
    const connection = await fetchJson(
      `${origin}/v1/model-provider-connections`,
      {
        method: "POST",
        body: {
          key: "gemini-batch",
          name: "Gemini batch",
          provider: "GOOGLE_GEMINI",
        },
      },
    );
    expect(connection.status).toBe(201);
    const connectionId = (connection.body as { id: string }).id;
    const connectionVersion = await fetchJson(
      `${origin}/v1/model-provider-connections/${connectionId}/versions`,
      {
        method: "POST",
        body: {
          endpoint: {
            baseUrl: `${fakeOrigin}/v1beta`,
            allowPrivateNetworks: true,
          },
          credentialRef: { key: "GOOGLE_GEMINI_API_KEY" },
        },
      },
    );
    expect(connectionVersion.status).toBe(201);
    const providerConnectionVersionId = (
      connectionVersion.body as { id: string }
    ).id;
    const profile = await fetchJson(`${origin}/v1/model-profiles`, {
      method: "POST",
      body: { key: "batch-gemini", name: "Gemini batch" },
    });
    const modelProfileId = (profile.body as { id: string }).id;
    const version = await fetchJson(
      `${origin}/v1/model-profiles/${modelProfileId}/versions`,
      {
        method: "POST",
        body: {
          provider: "GOOGLE_GEMINI",
          model: "gemini-1.5-flash",
          modelProviderConnectionVersionId: providerConnectionVersionId,
        },
      },
    );
    expect(version.status).toBe(201);
    return {
      modelProfileVersionId: (version.body as { id: string }).id,
      providerConnectionVersionId,
    };
  }

  function buildCreateBody(input: {
    workspaceId: WorkspaceId;
    modelProfileVersionId: string;
    providerConnectionVersionId: string;
    fingerprint: string;
    items: Array<{ providerCorrelationId: string; content: string }>;
  }) {
    return {
      workspaceId: input.workspaceId,
      submissionFingerprint: input.fingerprint,
      modelProfileVersionId: input.modelProfileVersionId,
      providerConnectionVersionId: input.providerConnectionVersionId,
      items: input.items.map((item) => ({
        itemId: randomUUID() as BatchInferenceItemId,
        providerCorrelationId: item.providerCorrelationId,
        input: {
          messages: [{ role: "user" as const, content: item.content }],
        },
      })),
    };
  }

  it("A: authorized create → worker submit → reconcile → GET results", async () => {
    const trustedRuntimeRoot = await prepareTrustedRuntimeRoot();
    const fake = await startFakeOpenAiBatchServer();
    const policies = new PostgresWorkspaceBatchInferencePolicyRepository(
      database,
    );
    await policies.upsertPolicy(WORKSPACE_A, {
      batchInferenceEnabled: true,
      denySensitiveWorkloads: true,
    });

    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      }),
    );
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_EXECUTION_RECOVERY_POLL_MS: "300",
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        OPENAI_API_KEY: "test-key",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        openai: {
          apiKey: "test-key",
          baseURL: `${fake.origin}/v1`,
          maxRetries: 0,
        },
      },
    );

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const binding = await seedOpenAiBinding(origin, fake.origin);

      const created = await fetchJson(`${origin}/v1/batch-inference-jobs`, {
        method: "POST",
        body: buildCreateBody({
          workspaceId: WORKSPACE_A,
          ...binding,
          fingerprint: "fp-batch-lifecycle-a",
          items: [
            { providerCorrelationId: "corr_b", content: "second" },
            { providerCorrelationId: "corr_a", content: "first" },
          ],
        }),
      });
      expect(created.status).toBe(201);
      const jobId = (created.body as { job: { id: string } }).job.id;

      const terminal = await waitForJobTerminal(origin, jobId);
      expect(terminal.status).toBe("COMPLETED");
      expect(terminal.progressSucceeded).toBe(2);
      expect(fake.batchCreateCount()).toBe(1);

      const items = await fetchJson(
        `${origin}/v1/batch-inference-jobs/${jobId}/items`,
      );
      expect(items.status).toBe(200);
      const rows = (items.body as { items: Array<Record<string, unknown>> })
        .items;
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.status === "SUCCEEDED")).toBe(true);

      const repo = new PostgresBatchInferenceJobRepository(database);
      const persisted = await repo.findJobById(WORKSPACE_A, jobId as never);
      expect(persisted?.providerBatchId).toMatch(/^batch_/);

      const tokenB = await mintWorkspaceApiKey(
        database,
        WORKSPACE_B,
        "Batch B",
      );
      const crossWorkspace = await fetchJsonWithToken(
        `${origin}/v1/batch-inference-jobs/${jobId}`,
        tokenB,
      );
      expect(crossWorkspace.status).toBe(404);
    } finally {
      await worker.stop();
      await web.stop();
      await fake.close();
    }
  });

  it("B: disabled policy rejects creation", async () => {
    const trustedRuntimeRoot = await prepareTrustedRuntimeRoot();
    const fake = await startFakeOpenAiBatchServer();
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      }),
    );
    const worker = createWorkerProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      OPENAI_API_KEY: "test-key",
    });
    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const binding = await seedOpenAiBinding(origin, fake.origin);
      const created = await fetchJson(`${origin}/v1/batch-inference-jobs`, {
        method: "POST",
        body: buildCreateBody({
          workspaceId: WORKSPACE_A,
          ...binding,
          fingerprint: "fp-disabled-policy",
          items: [{ providerCorrelationId: "c1", content: "x" }],
        }),
      });
      expect(created.status).toBeGreaterThanOrEqual(400);
    } finally {
      await worker.stop();
      await web.stop();
      await fake.close();
    }
  });

  it("D: ambiguous SUBMITTING job is not blindly resubmitted", async () => {
    const fake = await startFakeOpenAiBatchServer();
    const jobs = new PostgresBatchInferenceJobRepository(database);
    const bundle = createBatchInferenceWorkerBundle({
      database,
      secretResolver: new ProcessEnvSecretResolver({
        OPENAI_API_KEY: "test-key",
      }),
      clock: { now: () => new Date() },
      batchLimit: 10,
    });
    const jobId = randomUUID();
    const now = new Date();
    await jobs.createJobWithItems({
      job: {
        id: jobId as never,
        workspaceId: WORKSPACE_A,
        status: "SUBMITTING",
        provider: "OPENAI",
        modelProfileVersionId: "mpv-test" as never,
        providerConnectionVersionId: "mpcv-test" as never,
        providerModelId: "gpt-4o-mini",
        submissionFingerprint: "fp-ambiguous",
        requestMaterialHash: "legacy-ambiguous-test",
        reconciliationRequired: true,
        reconciliationNote: "provider accepted; local ack lost",
        progressTotal: 1,
        progressPending: 1,
        progressProcessing: 0,
        progressSucceeded: 0,
        progressFailed: 0,
        progressCancelled: 0,
        progressExpired: 0,
        reconcileAfterAt: now,
        createdAt: now,
        updatedAt: now,
      },
      items: [
        {
          id: randomUUID() as never,
          jobId: jobId as never,
          workspaceId: WORKSPACE_A,
          providerCorrelationId: "corr_a",
          status: "PENDING",
          input: { messages: [{ role: "user", content: "hi" }] },
        },
      ],
    });

    await bundle.processor.execute({ batchLimit: 5 });
    expect(fake.batchCreateCount()).toBe(0);
    await fake.close();
  });

  it("C: idempotency key returns same job or conflicts on material change", async () => {
    const trustedRuntimeRoot = await prepareTrustedRuntimeRoot();
    const fake = await startFakeOpenAiBatchServer();
    await new PostgresWorkspaceBatchInferencePolicyRepository(
      database,
    ).upsertPolicy(WORKSPACE_A, {
      batchInferenceEnabled: true,
      denySensitiveWorkloads: true,
    });
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      }),
    );
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_EXECUTION_RECOVERY_POLL_MS: "300",
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        OPENAI_API_KEY: "test-key",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        openai: {
          apiKey: "test-key",
          baseURL: `${fake.origin}/v1`,
          maxRetries: 0,
        },
      },
    );
    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const binding = await seedOpenAiBinding(origin, fake.origin);
      const fingerprint = "fp-idem-c-12345678";
      const first = await fetchJson(`${origin}/v1/batch-inference-jobs`, {
        method: "POST",
        body: buildCreateBody({
          workspaceId: WORKSPACE_A,
          ...binding,
          fingerprint,
          items: [{ providerCorrelationId: "c1", content: "x" }],
        }),
      });
      const second = await fetchJson(`${origin}/v1/batch-inference-jobs`, {
        method: "POST",
        body: buildCreateBody({
          workspaceId: WORKSPACE_A,
          ...binding,
          fingerprint,
          items: [{ providerCorrelationId: "c1", content: "x" }],
        }),
      });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const id1 = (first.body as { job: { id: string } }).job.id;
      const id2 = (second.body as { job: { id: string } }).job.id;
      expect(id2).toBe(id1);
      await waitForProviderBatchId(origin, id1);
      expect(fake.batchCreateCount()).toBe(1);

      const conflict = await fetchJson(`${origin}/v1/batch-inference-jobs`, {
        method: "POST",
        body: buildCreateBody({
          workspaceId: WORKSPACE_A,
          ...binding,
          fingerprint,
          items: [{ providerCorrelationId: "c1", content: "changed" }],
        }),
      });
      expect(conflict.status).toBe(409);
    } finally {
      await worker.stop();
      await web.stop();
      await fake.close();
    }
  });

  it("E: repeated reconciliation does not duplicate item outcomes", async () => {
    const trustedRuntimeRoot = await prepareTrustedRuntimeRoot();
    const fake = await startFakeOpenAiBatchServer();
    await new PostgresWorkspaceBatchInferencePolicyRepository(
      database,
    ).upsertPolicy(WORKSPACE_A, {
      batchInferenceEnabled: true,
      denySensitiveWorkloads: true,
    });
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      }),
    );
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_EXECUTION_RECOVERY_POLL_MS: "300",
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        OPENAI_API_KEY: "test-key",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        openai: {
          apiKey: "test-key",
          baseURL: `${fake.origin}/v1`,
          maxRetries: 0,
        },
      },
    );
    const bundle = createBatchInferenceWorkerBundle({
      database,
      secretResolver: new ProcessEnvSecretResolver({
        OPENAI_API_KEY: "test-key",
      }),
      clock: { now: () => new Date() },
      batchLimit: 10,
    });
    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const binding = await seedOpenAiBinding(origin, fake.origin);
      const created = await fetchJson(`${origin}/v1/batch-inference-jobs`, {
        method: "POST",
        body: buildCreateBody({
          workspaceId: WORKSPACE_A,
          ...binding,
          fingerprint: "fp-reconcile-e-12345",
          items: [{ providerCorrelationId: "corr_e", content: "hello" }],
        }),
      });
      const jobId = (created.body as { job: { id: string } }).job.id;
      await waitForJobTerminal(origin, jobId);
      const jobs = new PostgresBatchInferenceJobRepository(database);
      const before = await jobs.listItemsForJob(jobId as never);
      const succeededBefore = before.filter(
        (item) => item.status === "SUCCEEDED",
      );
      expect(succeededBefore).toHaveLength(1);

      const internal = await jobs.findJobByIdInternal(jobId as never);
      expect(internal).not.toBeNull();
      await jobs.updateJobProgress(jobId as never, {
        status: "FINALIZING",
        reconcileAfterAt: new Date(),
      });
      await bundle.processor.execute({ batchLimit: 5 });
      await bundle.processor.execute({ batchLimit: 5 });

      const after = await jobs.listItemsForJob(jobId as never);
      expect(after.filter((item) => item.status === "SUCCEEDED")).toHaveLength(
        1,
      );
      expect(after[0]?.usage).toEqual(succeededBefore[0]?.usage);
    } finally {
      await worker.stop();
      await web.stop();
      await fake.close();
    }
  });

  it("F: cancel persists intent and worker cancels provider batch", async () => {
    const trustedRuntimeRoot = await prepareTrustedRuntimeRoot();
    const fake = await startFakeOpenAiBatchServer({ deferCompletion: true });
    await new PostgresWorkspaceBatchInferencePolicyRepository(
      database,
    ).upsertPolicy(WORKSPACE_A, {
      batchInferenceEnabled: true,
      denySensitiveWorkloads: true,
    });
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      }),
    );
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_EXECUTION_RECOVERY_POLL_MS: "300",
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        OPENAI_API_KEY: "test-key",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        openai: {
          apiKey: "test-key",
          baseURL: `${fake.origin}/v1`,
          maxRetries: 0,
        },
      },
    );
    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const binding = await seedOpenAiBinding(origin, fake.origin);
      const created = await fetchJson(`${origin}/v1/batch-inference-jobs`, {
        method: "POST",
        body: buildCreateBody({
          workspaceId: WORKSPACE_A,
          ...binding,
          fingerprint: "fp-cancel-f-123456",
          items: [{ providerCorrelationId: "corr_f", content: "cancel me" }],
        }),
      });
      expect(created.status).toBe(201);
      const jobId = (created.body as { job: { id: string } }).job.id;
      await waitForProviderBatchId(origin, jobId);

      const cancelled = await fetchJson(
        `${origin}/v1/batch-inference-jobs/${jobId}/cancel`,
        { method: "POST" },
      );
      expect(cancelled.status).toBe(200);
      const terminal = await waitForJobTerminal(origin, jobId, 60_000);
      expect(terminal.status).toBe("CANCELLED");
      expect(fake.cancelRequestCount()).toBeGreaterThanOrEqual(1);
    } finally {
      await worker.stop();
      await web.stop();
      await fake.close();
    }
  }, 90_000);

  it("B: Anthropic native submit → poll → GET results", async () => {
    const trustedRuntimeRoot = await prepareTrustedRuntimeRoot();
    const fake = await startFakeAnthropicBatchServer();
    await new PostgresWorkspaceBatchInferencePolicyRepository(
      database,
    ).upsertPolicy(WORKSPACE_A, {
      batchInferenceEnabled: true,
      denySensitiveWorkloads: true,
    });
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      }),
    );
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_EXECUTION_RECOVERY_POLL_MS: "300",
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        ANTHROPIC_API_KEY: "test-key",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
    );
    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const binding = await seedAnthropicBinding(origin, fake.origin);
      const created = await fetchJson(`${origin}/v1/batch-inference-jobs`, {
        method: "POST",
        body: buildCreateBody({
          workspaceId: WORKSPACE_A,
          ...binding,
          fingerprint: "fp-anthropic-b-123456",
          items: [
            { providerCorrelationId: "a_corr", content: "anthropic e2e" },
          ],
        }),
      });
      expect(created.status).toBe(201);
      const jobId = (created.body as { job: { id: string } }).job.id;
      const terminal = await waitForJobTerminal(origin, jobId);
      expect(terminal.status).toBe("COMPLETED");
      expect(fake.batchCreateCount()).toBe(1);
    } finally {
      await worker.stop();
      await web.stop();
      await fake.close();
    }
  });

  it("C: Gemini native submit → poll → GET results", async () => {
    const trustedRuntimeRoot = await prepareTrustedRuntimeRoot();
    const fake = await startFakeGeminiBatchServer();
    await new PostgresWorkspaceBatchInferencePolicyRepository(
      database,
    ).upsertPolicy(WORKSPACE_A, {
      batchInferenceEnabled: true,
      denySensitiveWorkloads: true,
    });
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      }),
    );
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_EXECUTION_RECOVERY_POLL_MS: "300",
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        GOOGLE_GEMINI_API_KEY: "test-key",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
    );
    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const binding = await seedGeminiBinding(origin, fake.origin);
      const created = await fetchJson(`${origin}/v1/batch-inference-jobs`, {
        method: "POST",
        body: buildCreateBody({
          workspaceId: WORKSPACE_A,
          ...binding,
          fingerprint: "fp-gemini-c-1234567",
          items: [{ providerCorrelationId: "g_corr", content: "gemini e2e" }],
        }),
      });
      expect(created.status).toBe(201);
      const jobId = (created.body as { job: { id: string } }).job.id;
      const terminal = await waitForJobTerminal(origin, jobId);
      expect(terminal.status).toBe("COMPLETED");
      expect(fake.batchCreateCount()).toBe(1);
    } finally {
      await worker.stop();
      await web.stop();
      await fake.close();
    }
  });

  async function enableOpenAiBatchPolicy(): Promise<void> {
    await new PostgresWorkspaceBatchInferencePolicyRepository(
      database,
    ).upsertPolicy(WORKSPACE_A, {
      batchInferenceEnabled: true,
      denySensitiveWorkloads: true,
    });
  }

  it("D: mixed successful and failed items", async () => {
    const trustedRuntimeRoot = await prepareTrustedRuntimeRoot();
    const fake = await startFakeOpenAiBatchServer({
      failItemCorrelationIds: ["corr_fail"],
    });
    await enableOpenAiBatchPolicy();
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      }),
    );
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_EXECUTION_RECOVERY_POLL_MS: "300",
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        OPENAI_API_KEY: "test-key",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        openai: {
          apiKey: "test-key",
          baseURL: `${fake.origin}/v1`,
          maxRetries: 0,
        },
      },
    );
    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const binding = await seedOpenAiBinding(origin, fake.origin);
      const created = await fetchJson(`${origin}/v1/batch-inference-jobs`, {
        method: "POST",
        body: buildCreateBody({
          workspaceId: WORKSPACE_A,
          ...binding,
          fingerprint: "fp-mixed-d-12345678",
          items: [
            { providerCorrelationId: "corr_ok", content: "ok" },
            { providerCorrelationId: "corr_fail", content: "fail" },
          ],
        }),
      });
      expect(created.status).toBe(201);
      const jobId = (created.body as { job: { id: string } }).job.id;
      const terminal = await waitForJobTerminal(origin, jobId);
      expect(terminal.status).toBe("PARTIALLY_COMPLETED");
      expect(terminal.progressSucceeded).toBe(1);
      expect(terminal.progressFailed).toBe(1);
    } finally {
      await worker.stop();
      await web.stop();
      await fake.close();
    }
  }, 90_000);

  it("E: polling failure recovers and completes", async () => {
    const trustedRuntimeRoot = await prepareTrustedRuntimeRoot();
    const fake = await startFakeOpenAiBatchServer({
      statusPollFailuresRemaining: 2,
    });
    await enableOpenAiBatchPolicy();
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      }),
    );
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_EXECUTION_RECOVERY_POLL_MS: "300",
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        OPENAI_API_KEY: "test-key",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        openai: {
          apiKey: "test-key",
          baseURL: `${fake.origin}/v1`,
          maxRetries: 0,
        },
      },
    );
    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const binding = await seedOpenAiBinding(origin, fake.origin);
      const created = await fetchJson(`${origin}/v1/batch-inference-jobs`, {
        method: "POST",
        body: buildCreateBody({
          workspaceId: WORKSPACE_A,
          ...binding,
          fingerprint: "fp-poll-e-12345678",
          items: [{ providerCorrelationId: "corr_a", content: "poll" }],
        }),
      });
      expect(created.status).toBe(201);
      const jobId = (created.body as { job: { id: string } }).job.id;
      const terminal = await waitForJobTerminal(origin, jobId);
      expect(terminal.status).toBe("COMPLETED");
      expect(fake.batchCreateCount()).toBe(1);
    } finally {
      await worker.stop();
      await web.stop();
      await fake.close();
    }
  }, 90_000);

  it("F2: worker restart recovers persisted provider batch", async () => {
    const trustedRuntimeRoot = await prepareTrustedRuntimeRoot();
    const fake = await startFakeOpenAiBatchServer();
    await enableOpenAiBatchPolicy();
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      }),
    );
    const workerEnv = {
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_EXECUTION_RECOVERY_POLL_MS: "300",
      OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      OPENAI_API_KEY: "test-key",
    };
    const workerOverrides = {
      openai: {
        apiKey: "test-key",
        baseURL: `${fake.origin}/v1`,
        maxRetries: 0,
      },
    };
    const worker = createWorkerProcess(
      workerEnv,
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      workerOverrides,
    );
    const worker2 = createWorkerProcess(
      workerEnv,
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      workerOverrides,
    );
    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const binding = await seedOpenAiBinding(origin, fake.origin);
      const created = await fetchJson(`${origin}/v1/batch-inference-jobs`, {
        method: "POST",
        body: buildCreateBody({
          workspaceId: WORKSPACE_A,
          ...binding,
          fingerprint: "fp-restart-f-1234567",
          items: [{ providerCorrelationId: "corr_a", content: "restart" }],
        }),
      });
      const jobId = (created.body as { job: { id: string } }).job.id;
      await waitForProviderBatchId(origin, jobId);
      await worker.stop();
      await worker2.start();
      const terminal = await waitForJobTerminal(origin, jobId);
      expect(terminal.status).toBe("COMPLETED");
      expect(fake.batchCreateCount()).toBe(1);
    } finally {
      await worker2.stop();
      await web.stop();
      await fake.close();
    }
  }, 90_000);

  it("G: cancellation after partial provider processing", async () => {
    const trustedRuntimeRoot = await prepareTrustedRuntimeRoot();
    const fake = await startFakeOpenAiBatchServer({ deferCompletion: true });
    await enableOpenAiBatchPolicy();
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      }),
    );
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_EXECUTION_RECOVERY_POLL_MS: "300",
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        OPENAI_API_KEY: "test-key",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        openai: {
          apiKey: "test-key",
          baseURL: `${fake.origin}/v1`,
          maxRetries: 0,
        },
      },
    );
    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const binding = await seedOpenAiBinding(origin, fake.origin);
      const created = await fetchJson(`${origin}/v1/batch-inference-jobs`, {
        method: "POST",
        body: buildCreateBody({
          workspaceId: WORKSPACE_A,
          ...binding,
          fingerprint: "fp-cancel-g-12345678",
          items: [
            { providerCorrelationId: "corr_a", content: "a" },
            { providerCorrelationId: "corr_b", content: "b" },
          ],
        }),
      });
      const jobId = (created.body as { job: { id: string } }).job.id;
      await waitForProviderBatchId(origin, jobId);
      const cancel = await fetchJson(
        `${origin}/v1/batch-inference-jobs/${jobId}/cancel`,
        { method: "POST", body: {} },
      );
      expect(cancel.status).toBe(200);
      const terminal = await waitForJobTerminal(origin, jobId, 60_000);
      expect(terminal.progressSucceeded).toBe(1);
      expect(
        terminal.status === "PARTIALLY_COMPLETED" ||
          terminal.status === "CANCELLED",
      ).toBe(true);
      expect(fake.cancelRequestCount()).toBeGreaterThanOrEqual(1);
    } finally {
      await worker.stop();
      await web.stop();
      await fake.close();
    }
  }, 90_000);

  it("I: dual-worker submit race creates one provider batch", async () => {
    const fake = await startFakeOpenAiBatchServer();
    await enableOpenAiBatchPolicy();
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      }),
    );
    try {
      const port = await web.listen();
      const origin = `http://127.0.0.1:${String(port)}`;
      const binding = await seedOpenAiBinding(origin, fake.origin);
      const created = await fetchJson(`${origin}/v1/batch-inference-jobs`, {
        method: "POST",
        body: buildCreateBody({
          workspaceId: WORKSPACE_A,
          ...binding,
          fingerprint: "fp-race-i-12345678",
          items: [{ providerCorrelationId: "corr_a", content: "race" }],
        }),
      });
      expect(created.status).toBe(201);
      const jobId = (created.body as { job: { id: string } }).job.id;
      const bundleA = createBatchInferenceWorkerBundle({
        database,
        secretResolver: new ProcessEnvSecretResolver({
          OPENAI_API_KEY: "test-key",
        }),
        clock: { now: () => new Date() },
        batchLimit: 10,
        workerId: "integration-batch-worker-a",
      });
      const bundleB = createBatchInferenceWorkerBundle({
        database,
        secretResolver: new ProcessEnvSecretResolver({
          OPENAI_API_KEY: "test-key",
        }),
        clock: { now: () => new Date() },
        batchLimit: 10,
        workerId: "integration-batch-worker-b",
      });
      await Promise.all([
        bundleA.processor.execute({ batchLimit: 5 }),
        bundleB.processor.execute({ batchLimit: 5 }),
      ]);
      expect(fake.batchCreateCount()).toBe(1);
      const jobs = new PostgresBatchInferenceJobRepository(database);
      const job = await jobs.findJobById(WORKSPACE_A, jobId as never);
      expect(job?.providerBatchId).toMatch(/^batch_/);
    } finally {
      await web.stop();
      await fake.close();
    }
  });

  it("M: unknown provider correlation id is quarantined", async () => {
    const trustedRuntimeRoot = await prepareTrustedRuntimeRoot();
    const fake = await startFakeOpenAiBatchServer({
      extraOutputCorrelationIds: ["ghost_corr"],
    });
    await enableOpenAiBatchPolicy();
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      }),
    );
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_EXECUTION_RECOVERY_POLL_MS: "300",
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        OPENAI_API_KEY: "test-key",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        openai: {
          apiKey: "test-key",
          baseURL: `${fake.origin}/v1`,
          maxRetries: 0,
        },
      },
    );
    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const binding = await seedOpenAiBinding(origin, fake.origin);
      const created = await fetchJson(`${origin}/v1/batch-inference-jobs`, {
        method: "POST",
        body: buildCreateBody({
          workspaceId: WORKSPACE_A,
          ...binding,
          fingerprint: "fp-ghost-m-12345678",
          items: [{ providerCorrelationId: "corr_a", content: "ghost" }],
        }),
      });
      const jobId = (created.body as { job: { id: string } }).job.id;
      await waitForJobTerminal(origin, jobId);
      const repo = new PostgresBatchInferenceJobRepository(database);
      const job = await repo.findJobById(WORKSPACE_A, jobId as never);
      expect(job?.reconciliationRequired).toBe(true);
      expect(job?.reconciliationNote).toContain("provider_correlation_anomaly");
    } finally {
      await worker.stop();
      await web.stop();
      await fake.close();
    }
  }, 90_000);

  it("G: migration 0041 policy repository read/write", async () => {
    const policies = new PostgresWorkspaceBatchInferencePolicyRepository(
      database,
    );
    await policies.upsertPolicy(WORKSPACE_A, {
      batchInferenceEnabled: true,
      denySensitiveWorkloads: false,
      allowedProviders: ["OPENAI"],
    });
    const read = await policies.findPolicyByWorkspaceId(WORKSPACE_A);
    expect(read?.batchInferenceEnabled).toBe(true);
    expect(read?.allowedProviders).toEqual(["OPENAI"]);
    await policies.upsertPolicy(WORKSPACE_A, {
      batchInferenceEnabled: false,
      denySensitiveWorkloads: true,
    });
    const disabled = await policies.findPolicyByWorkspaceId(WORKSPACE_A);
    expect(disabled?.batchInferenceEnabled).toBe(false);
  });
});
