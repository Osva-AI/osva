import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ToolVersionId, WorkspaceId } from "@osva/contracts";
import { serveStreamableHttp } from "@osva/connector-sdk";
import { echoConnector } from "../../../../examples/echo-connector/src/connector.js";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import {
  createDatabase,
  migrateDatabase,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import { Workspace } from "@osva/domain";

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

const WORKSPACE_ID = "ws-connector-sdk" as WorkspaceId;
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

describe("connector-sdk MCP compatibility", () => {
  const integrationTimeoutMs = 60_000;
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
        createdAt: new Date("2026-01-15T12:00:00.000Z"),
      }),
    );
  });

  it(
    "imports and executes a connector-sdk HTTP connector through ToolGateway",
    async () => {
      const httpServer = await serveStreamableHttp({
        connector: echoConnector,
        host: "127.0.0.1",
        port: 0,
      });
      const address = httpServer.address();
      if (address === null || typeof address === "string") {
        throw new Error("Failed to bind connector-sdk HTTP server.");
      }
      const endpointUrl = `http://127.0.0.1:${String(address.port)}/mcp`;

      const trustedRuntimeRoot = await copyAgentFixtures("mcp-echo-agent.ts");
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

      try {
        const port = await web.listen();
        await worker.start();
        const origin = `http://127.0.0.1:${String(port)}`;
        const toolVersionId = await seedEchoTool(origin, endpointUrl);
        const integrity = sha256IntegrityOf(
          await fs.readFile(path.join(trustedRuntimeRoot, "mcp-echo-agent.ts")),
        );

        const agent = await fetchJson(`${origin}/v1/agents`, {
          method: "POST",
          body: {
            workspaceId: WORKSPACE_ID,
            key: "sdk-agent",
            name: "SDK Agent",
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
                key: "sdk-agent",
                name: "SDK Agent",
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
            workspaceId: WORKSPACE_ID,
            agentId,
            agentVersionId,
            input: { hello: "connector-sdk" },
          },
        });
        const runId = (created.body as { run: { id: string } }).run.id;

        await waitUntil(async () => {
          const run = await fetchJson(`${origin}/v1/runs/${runId}`);
          return (run.body as { status?: string }).status === "SUCCEEDED";
        });

        const run = await fetchJson(`${origin}/v1/runs/${runId}`);
        expect(
          (
            run.body as {
              effectiveBindings?: { toolVersionBindings?: unknown };
            }
          ).effectiveBindings?.toolVersionBindings,
        ).toEqual({ echo: toolVersionId });
      } finally {
        await worker.stop();
        await web.stop();
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }
    },
    integrationTimeoutMs,
  );
});

async function seedEchoTool(origin: string, endpointUrl: string) {
  const connector = await fetchJson(`${origin}/v1/connectors`, {
    method: "POST",
    body: {
      workspaceId: WORKSPACE_ID,
      key: "connector-sdk-echo",
      name: "Connector SDK Echo",
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
    path.join(os.tmpdir(), "osva-connector-sdk-e2e-"),
  );
  for (const file of files) {
    await fs.copyFile(
      path.join(FIXTURE_DIR, file),
      path.join(trustedRuntimeRoot, file),
    );
  }
  return trustedRuntimeRoot;
}

async function fetchJson(
  url: string,
  init?: { readonly method?: string; readonly body?: unknown },
) {
  const response = await fetch(url, {
    method: init?.method ?? "GET",
    headers:
      init?.body === undefined
        ? undefined
        : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return {
    status: response.status,
    body: await response.json(),
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
