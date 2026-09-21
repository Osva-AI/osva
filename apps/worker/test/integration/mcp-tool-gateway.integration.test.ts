import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ToolVersionId, WorkspaceId } from "@osva/contracts";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";

import { startFakeHttpMcpServer } from "@osva/adapters-mcp-client/testing";
import { bootstrapIntegrationAuth, fetchJson } from "./integration-auth.js";
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

const WORKSPACE_ID = "ws-mcp-e2e" as WorkspaceId;
const MCP_INTEGRATION_WEB_ENV = {
  OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS: "true",
} as const;

const MCP_INTEGRATION_WORKER_ENV = {
  OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS: "true",
} as const;
const NOW = new Date("2026-01-15T12:00:00.000Z");
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);
describe("MCP tool gateway end-to-end", () => {
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

  it("runs HTTP CreateRun through ToolGateway with an imported MCP tool", async () => {
    const fakeMcp = await startFakeHttpMcpServer();
    const trustedRuntimeRoot = await copyAgentFixtures("mcp-echo-agent.ts");

    const web = createWebProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
      ...MCP_INTEGRATION_WEB_ENV,
    });
    const worker = createWorkerProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      ...MCP_INTEGRATION_WORKER_ENV,
    });

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const toolVersionId = await seedMcpEchoTool(origin, fakeMcp.endpointUrl);
      const integrity = sha256IntegrityOf(
        await fs.readFile(path.join(trustedRuntimeRoot, "mcp-echo-agent.ts")),
      );

      const agent = await fetchJson(`${origin}/v1/agents`, {
        method: "POST",
        body: {
          key: "mcp-agent",
          name: "MCP Agent",
        },
      });
      const agentId = (agent.body as { id: string }).id;
      const agentVersion = await fetchJson(
        `${origin}/v1/agents/${agentId}/versions`,
        {
          method: "POST",
          body: {
            manifest: {
              schemaVersion: "1",
              key: "mcp-agent",
              name: "MCP Agent",
              runtime: {
                type: "TRUSTED_TYPESCRIPT",
                entrypoint: "mcp-echo-agent.ts",
                integrity,
              },
              input: { schema: {} },
              output: { schema: {} },
              execution: { timeoutMs: 10_000, maxAttempts: 1 },
              capabilities: { model: false, tools: ["echo"] },
              tools: {
                echo: { toolVersionId },
              },
            },
          },
        },
      );
      const agentVersionId = (agentVersion.body as { id: string }).id;

      const created = await fetchJson(`${origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId,
          agentVersionId,
          input: { hello: "mcp-e2e" },
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitUntil(async () => {
        const run = await fetchJson(`${origin}/v1/runs/${runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });

      expect(fakeMcp.toolCallCount).toBeGreaterThan(0);

      const attempt = await fetchJson(
        `${origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: {
          echoed: { hello: "mcp-e2e" },
          toolResult: JSON.stringify({ value: { hello: "mcp-e2e" } }),
        },
      });

      const run = await fetchJson(`${origin}/v1/runs/${runId}`);
      expect(
        (run.body as { effectiveBindings?: { toolVersionBindings?: unknown } })
          .effectiveBindings?.toolVersionBindings,
      ).toEqual({ echo: toolVersionId });
    } finally {
      await worker.stop();
      await web.stop();
      await fakeMcp.close();
    }
  });

  it("does not call MCP when an agent invokes an unbound tool", async () => {
    const fakeMcp = await startFakeHttpMcpServer();
    const trustedRuntimeRoot = await copyAgentFixtures(
      "mcp-echo-agent.ts",
      "mcp-unauthorized-agent.ts",
    );

    const web = createWebProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
      ...MCP_INTEGRATION_WEB_ENV,
    });
    const worker = createWorkerProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      ...MCP_INTEGRATION_WORKER_ENV,
    });

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const toolVersionId = await seedMcpEchoTool(origin, fakeMcp.endpointUrl);
      const integrity = sha256IntegrityOf(
        await fs.readFile(
          path.join(trustedRuntimeRoot, "mcp-unauthorized-agent.ts"),
        ),
      );

      const agent = await fetchJson(`${origin}/v1/agents`, {
        method: "POST",
        body: {
          key: "mcp-unauthorized-agent",
          name: "MCP Unauthorized Agent",
        },
      });
      const agentId = (agent.body as { id: string }).id;
      const agentVersion = await fetchJson(
        `${origin}/v1/agents/${agentId}/versions`,
        {
          method: "POST",
          body: {
            manifest: {
              schemaVersion: "1",
              key: "mcp-unauthorized-agent",
              name: "MCP Unauthorized Agent",
              runtime: {
                type: "TRUSTED_TYPESCRIPT",
                entrypoint: "mcp-unauthorized-agent.ts",
                integrity,
              },
              input: { schema: {} },
              output: { schema: {} },
              execution: { timeoutMs: 10_000, maxAttempts: 1 },
              capabilities: { model: false, tools: ["echo"] },
              tools: {
                echo: { toolVersionId },
              },
            },
          },
        },
      );
      const agentVersionId = (agentVersion.body as { id: string }).id;

      const created = await fetchJson(`${origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId,
          agentVersionId,
          input: {},
        },
      });
      const runId = (created.body as { run: { id: string } }).run.id;
      const runAttemptId = (created.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitUntil(async () => {
        const run = await fetchJson(`${origin}/v1/runs/${runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });

      expect(fakeMcp.toolCallCount).toBe(0);

      const attempt = await fetchJson(
        `${origin}/v1/runs/${runId}/attempts/${runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: {
          caught: true,
          code: "TOOL_BINDING_NOT_FOUND",
        },
      });
    } finally {
      await worker.stop();
      await web.stop();
      await fakeMcp.close();
    }
  });
});

async function seedMcpEchoTool(
  origin: string,
  endpointUrl: string,
): Promise<ToolVersionId> {
  const connector = await fetchJson(`${origin}/v1/connectors`, {
    method: "POST",
    body: {
      key: "fake-mcp",
      name: "Fake MCP",
    },
  });
  const connectorId = (connector.body as { id: string }).id;
  const version = await fetchJson(
    `${origin}/v1/connectors/${connectorId}/versions`,
    {
      method: "POST",
      body: {
        kind: "MCP",
        transport: "STREAMABLE_HTTP",
        transportConfig: { endpointUrl },
      },
    },
  );
  const connectorVersionId = (version.body as { id: string }).id;
  const imported = await fetchJson(`${origin}/v1/connectors/import-mcp-tools`, {
    method: "POST",
    body: {
      connectorVersionId,
      tools: [
        {
          remoteToolName: "echo",
          toolKey: "echo",
          toolName: "Echo",
        },
      ],
    },
  });
  return (
    imported.body as { imported: Array<{ toolVersionId: ToolVersionId }> }
  ).imported[0]!.toolVersionId;
}

async function copyAgentFixtures(...files: readonly string[]) {
  const trustedRuntimeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "osva-mcp-e2e-"),
  );
  for (const file of files) {
    await fs.copyFile(
      path.join(FIXTURE_DIR, file),
      path.join(trustedRuntimeRoot, file),
    );
  }
  return trustedRuntimeRoot;
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
