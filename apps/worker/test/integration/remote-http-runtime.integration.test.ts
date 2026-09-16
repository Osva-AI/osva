import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ToolVersionId, WorkspaceId } from "@osva/contracts";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import {
  createDatabase,
  migrateDatabase,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import { Workspace } from "@osva/domain";

import { startFakeRemoteRuntime } from "../../../../adapters/runtime-http/test/fake-remote-runtime.js";
import { startFakeOpenAIResponsesServer } from "../../../../adapters/model-openai/test/fake-openai-server.js";
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

const WORKSPACE_ID = "ws-remote-http" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");

describe("remote HTTP runtime end-to-end", () => {
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

  it("executes a remote HTTP agent through the worker dispatcher", async () => {
    const remote = await startFakeRemoteRuntime();
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-remote-e2e-"),
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
        `${remote.origin}/execute`,
        {
          prompt: "remote-e2e",
        },
      );

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
        output: { prompt: "remote-e2e" },
      });
      expect(remote.executeCount).toBe(1);
      expect(remote.lastRequest?.body.executionId).toBe(created.runAttemptId);
      expect(remote.lastRequest?.body.protocolVersion).toBe("1");
      expect(JSON.stringify(attempt.body)).not.toContain(
        remote.lastRequest?.body.capabilities.token,
      );
      expect(await inspector.countActiveJobs()).toBe(0);
    } finally {
      await worker.stop();
      await inspector.shutdown();
      await web.stop();
      await remote.close();
    }
  });

  it("rejects loopback REMOTE_HTTP destinations unless the operator opts in", async () => {
    const remote = await startFakeRemoteRuntime();
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-remote-ssrf-"),
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
    });

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const created = await createRemoteRun(
        origin,
        `${remote.origin}/execute`,
        { prompt: "ssrf" },
      );

      await waitUntil(async () => {
        const run = await fetchJson(`${origin}/v1/runs/${created.runId}`);
        return (run.body as { status?: string }).status === "FAILED";
      });

      const attempt = await fetchJson(
        `${origin}/v1/runs/${created.runId}/attempts/${created.runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        id: created.runAttemptId,
        status: "FAILED",
      });
      expect(JSON.stringify(attempt.body)).toContain(
        "not an allowed destination",
      );
      expect(remote.executeCount).toBe(0);
    } finally {
      await worker.stop();
      await web.stop();
      await remote.close();
    }
  });

  it("mediates remote model generation through ModelGateway", async () => {
    const remote = await startFakeRemoteRuntime({ callModel: true });
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-remote-model-"),
    );
    const web = createWebProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
    });
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        OSVA_RUNTIME_CAPABILITY_SECRET: "capability-secret",
        OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS: "true",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        openai: {
          apiKey: "test-key",
          baseURL: fakeOpenAI.origin,
          maxRetries: 0,
        },
      },
    );

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const profile = await fetchJson(`${origin}/v1/model-profiles`, {
        method: "POST",
        body: {
          workspaceId: WORKSPACE_ID,
          key: "primary",
          name: "Primary",
        },
      });
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
      const modelProfileVersionId = (version.body as { id: string }).id;
      const created = await createRemoteRun(
        origin,
        `${remote.origin}/execute`,
        { prompt: "model" },
        {
          capabilities: { model: true, tools: [] },
          models: { primary: { modelProfileVersionId } },
        },
      );

      await waitUntil(async () => {
        const run = await fetchJson(`${origin}/v1/runs/${created.runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });

      const steps = await fetchJson(
        `${origin}/v1/runs/${created.runId}/attempts/${created.runAttemptId}/steps`,
      );
      const items = (
        steps.body as { steps: Array<{ kind: string; status: string }> }
      ).steps;
      expect(
        items.some(
          (step) => step.kind === "MODEL" && step.status === "SUCCEEDED",
        ),
      ).toBe(true);
      expect(JSON.stringify(steps.body)).not.toContain("hello from remote");
    } finally {
      await worker.stop();
      await web.stop();
      await remote.close();
      await fakeOpenAI.close();
    }
  });

  it("mediates remote tool invocation through ToolGateway", async () => {
    const remote = await startFakeRemoteRuntime({ callTool: true });
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-remote-tool-"),
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

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const tool = await fetchJson(`${origin}/v1/tools`, {
        method: "POST",
        body: {
          workspaceId: WORKSPACE_ID,
          key: "echo",
          name: "Echo",
        },
      });
      const toolId = (tool.body as { id: string }).id;
      const version = await fetchJson(`${origin}/v1/tools/${toolId}/versions`, {
        method: "POST",
        body: { type: "INTERNAL", implementation: "OSVA_ECHO_V1" },
      });
      const toolVersionId = (version.body as { id: ToolVersionId }).id;
      const created = await createRemoteRun(
        origin,
        `${remote.origin}/execute`,
        { value: "remote-tool-e2e" },
        {
          capabilities: { model: false, tools: ["echo"] },
          tools: { echo: { toolVersionId } },
        },
      );

      await waitUntil(async () => {
        const run = await fetchJson(`${origin}/v1/runs/${created.runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });

      const attempt = await fetchJson(
        `${origin}/v1/runs/${created.runId}/attempts/${created.runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: { value: "remote-tool-e2e" },
      });
      const steps = await fetchJson(
        `${origin}/v1/runs/${created.runId}/attempts/${created.runAttemptId}/steps`,
      );
      const items = (steps.body as { steps: Array<{ kind: string }> }).steps;
      expect(items.some((step) => step.kind === "TOOL")).toBe(true);
    } finally {
      await worker.stop();
      await web.stop();
      await remote.close();
    }
  });
});

async function createRemoteRun(
  origin: string,
  endpoint: string,
  input: unknown,
  extras: {
    readonly capabilities?: { model: boolean; tools: string[] };
    readonly models?: Record<string, { modelProfileVersionId: string }>;
    readonly tools?: Record<string, { toolVersionId: string }>;
  } = {},
): Promise<{ readonly runId: string; readonly runAttemptId: string }> {
  const agent = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: {
      workspaceId: WORKSPACE_ID,
      key: `remote-${String(Date.now())}-${Math.random()}`,
      name: "Remote Agent",
    },
  });
  const agentId = (agent.body as { id: string }).id;
  const version = await fetchJson(`${origin}/v1/agents/${agentId}/versions`, {
    method: "POST",
    body: {
      manifest: {
        schemaVersion: "1",
        key: "remote-agent",
        name: "Remote Agent",
        runtime: {
          type: "REMOTE_HTTP",
          protocolVersion: "1",
          endpoint,
        },
        input: { schema: {} },
        output: { schema: {} },
        execution: { timeoutMs: 8_000, maxAttempts: 1 },
        capabilities: extras.capabilities ?? { model: false, tools: [] },
        models: extras.models,
        tools: extras.tools,
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
  throw new Error("Timed out waiting for remote HTTP runtime execution.");
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
