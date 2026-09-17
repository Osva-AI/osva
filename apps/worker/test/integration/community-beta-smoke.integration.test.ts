import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  MemoryNamespaceId,
  ToolVersionId,
  WorkspaceId,
} from "@osva/contracts";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import {
  createDatabase,
  migrateDatabase,
  PostgresMemoryNamespaceRepository,
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

const WORKSPACE_ID = "ws-community-beta-smoke" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

describe("Community Beta smoke", () => {
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

  it("runs Agent → AgentVersion → Run through runtime, ToolGateway, and MemoryGateway without external services", async () => {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-community-beta-smoke-"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, "tool-echo-agent.ts"),
      path.join(trustedRuntimeRoot, "tool-echo-agent.ts"),
    );
    await fs.copyFile(
      path.join(FIXTURE_DIR, "memory-echo-agent.ts"),
      path.join(trustedRuntimeRoot, "memory-echo-agent.ts"),
    );
    const toolIntegrity = sha256IntegrityOf(
      await fs.readFile(path.join(trustedRuntimeRoot, "tool-echo-agent.ts")),
    );
    const memoryIntegrity = sha256IntegrityOf(
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
    const memoryRepository = new PostgresMemoryNamespaceRepository(database);
    const runs = new PostgresRunRepository(database);

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;

      const ready = await fetchJson(`${origin}/ready`);
      expect(ready.status).toBe(200);

      const namespace = await fetchJson(`${origin}/v1/memory-namespaces`, {
        method: "POST",
        body: {
          workspaceId: WORKSPACE_ID,
          key: "store",
          name: "Store",
        },
      });
      expect(namespace.status).toBe(201);
      const namespaceId = (namespace.body as { id: MemoryNamespaceId }).id;
      await memoryRepository.setRecord({
        namespaceId,
        key: "greeting",
        value: { text: "community-beta" },
        updatedAt: NOW,
      });

      const tool = await fetchJson(`${origin}/v1/tools`, {
        method: "POST",
        body: {
          workspaceId: WORKSPACE_ID,
          key: "echo",
          name: "Echo",
        },
      });
      expect(tool.status).toBe(201);
      const toolId = (tool.body as { id: string }).id;
      const toolVersion = await fetchJson(
        `${origin}/v1/tools/${toolId}/versions`,
        {
          method: "POST",
          body: { type: "INTERNAL", implementation: "OSVA_ECHO_V1" },
        },
      );
      expect(toolVersion.status).toBe(201);
      const toolVersionId = (toolVersion.body as { id: ToolVersionId }).id;

      const toolAgent = await fetchJson(`${origin}/v1/agents`, {
        method: "POST",
        body: {
          workspaceId: WORKSPACE_ID,
          key: "tool-agent",
          name: "Tool Agent",
        },
      });
      const toolAgentId = (toolAgent.body as { id: string }).id;
      const toolAgentVersion = await fetchJson(
        `${origin}/v1/agents/${toolAgentId}/versions`,
        {
          method: "POST",
          body: {
            manifest: {
              schemaVersion: "1",
              key: "tool-agent",
              name: "Tool Agent",
              runtime: {
                type: "TRUSTED_TYPESCRIPT",
                entrypoint: "tool-echo-agent.ts",
                integrity: toolIntegrity,
              },
              input: { schema: {} },
              output: { schema: {} },
              execution: { timeoutMs: 8_000, maxAttempts: 1 },
              capabilities: { model: false, tools: ["echo"] },
              tools: {
                echo: { toolVersionId },
              },
            },
          },
        },
      );
      const toolAgentVersionId = (toolAgentVersion.body as { id: string }).id;

      const toolRun = await fetchJson(`${origin}/v1/runs`, {
        method: "POST",
        body: {
          workspaceId: WORKSPACE_ID,
          agentId: toolAgentId,
          agentVersionId: toolAgentVersionId,
          input: { hello: "community-beta" },
        },
      });
      expect(toolRun.status).toBe(201);
      const toolRunId = (toolRun.body as { run: { id: string } }).run.id;
      const toolRunAttemptId = (toolRun.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitUntil(async () => {
        const run = await runs.findRunById(toolRunId);
        return run?.status === "SUCCEEDED";
      });

      const toolAttempt = await fetchJson(
        `${origin}/v1/runs/${toolRunId}/attempts/${toolRunAttemptId}`,
      );
      expect(toolAttempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: {
          echoed: { hello: "community-beta" },
          toolResult: { value: { hello: "community-beta" } },
        },
      });

      const toolSteps = await fetchJson(
        `${origin}/v1/runs/${toolRunId}/attempts/${toolRunAttemptId}/steps`,
      );
      expect(toolSteps.status).toBe(200);
      expect(
        (toolSteps.body as { steps: readonly { kind: string }[] }).steps.some(
          (step) => step.kind === "TOOL",
        ),
      ).toBe(true);

      const memoryAgent = await fetchJson(`${origin}/v1/agents`, {
        method: "POST",
        body: {
          workspaceId: WORKSPACE_ID,
          key: "memory-agent",
          name: "Memory Agent",
        },
      });
      const memoryAgentId = (memoryAgent.body as { id: string }).id;
      const memoryAgentVersion = await fetchJson(
        `${origin}/v1/agents/${memoryAgentId}/versions`,
        {
          method: "POST",
          body: {
            manifest: {
              schemaVersion: "1",
              key: "memory-agent",
              name: "Memory Agent",
              runtime: {
                type: "TRUSTED_TYPESCRIPT",
                entrypoint: "memory-echo-agent.ts",
                integrity: memoryIntegrity,
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
      const memoryAgentVersionId = (memoryAgentVersion.body as { id: string })
        .id;

      const memoryRun = await fetchJson(`${origin}/v1/runs`, {
        method: "POST",
        body: {
          workspaceId: WORKSPACE_ID,
          agentId: memoryAgentId,
          agentVersionId: memoryAgentVersionId,
          input: { memoryKey: "greeting" },
        },
      });
      const memoryRunId = (memoryRun.body as { run: { id: string } }).run.id;
      const memoryRunAttemptId = (
        memoryRun.body as { runAttempt: { id: string } }
      ).runAttempt.id;

      await waitUntil(async () => {
        const run = await runs.findRunById(memoryRunId);
        return run?.status === "SUCCEEDED";
      });

      const memoryAttempt = await fetchJson(
        `${origin}/v1/runs/${memoryRunId}/attempts/${memoryRunAttemptId}`,
      );
      expect(memoryAttempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: {
          memoryValue: { text: "community-beta" },
          memoryRevision: 1,
        },
      });

      const memorySteps = await fetchJson(
        `${origin}/v1/runs/${memoryRunId}/attempts/${memoryRunAttemptId}/steps`,
      );
      expect(memorySteps.status).toBe(200);
      expect(
        (memorySteps.body as { steps: readonly { kind: string }[] }).steps.some(
          (step) => step.kind === "MEMORY",
        ),
      ).toBe(true);
    } finally {
      await worker.stop();
      await web.stop();
    }
  }, 120_000);
});

async function fetchJson(
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text.length > 0 ? JSON.parse(text) : null,
  };
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs = 30_000,
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
