import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { WorkspaceId } from "@osva/contracts";
import { OSVA_MCP_TOOL_NAMES } from "@osva/contracts";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import {
  createDatabase,
  migrateDatabase,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import { Workspace } from "@osva/domain";

import { createWebProcess } from "../../../web/src/process.js";
import { createWorkerProcess } from "../../../worker/src/process.js";
import { createWorkflowOrchestratorProcess } from "../../../workflow-orchestrator/src/process.js";
import { createMcpServerProcess } from "../../src/process.js";
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

const WORKSPACE_A = "ws-mcp-server-a" as WorkspaceId;
const WORKSPACE_B = "ws-mcp-server-b" as WorkspaceId;
const MCP_TOKEN_A = "mcp-token-workspace-a";
const MCP_TOKEN_B = "mcp-token-workspace-b";
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

describe("OSVA inbound MCP server end-to-end", () => {
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
    const repo = new PostgresWorkspaceRepository(database);
    await repo.save(
      Workspace.create({
        id: WORKSPACE_A,
        name: "Workspace A",
        createdAt: new Date("2026-01-15T12:00:00.000Z"),
      }),
    );
    await repo.save(
      Workspace.create({
        id: WORKSPACE_B,
        name: "Workspace B",
        createdAt: new Date("2026-01-15T12:00:00.000Z"),
      }),
    );
  });

  it("runs agent and workflow flows through MCP tools with workspace isolation", async () => {
    const trustedRuntimeRoot = await copyAgentFixture("echo-agent.ts");
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
    const orchestrator = createWorkflowOrchestratorProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
    });

    const webPort = await web.listen();
    const webOrigin = `http://127.0.0.1:${String(webPort)}`;

    const mcp = createMcpServerProcess({
      OSVA_API_BASE_URL: webOrigin,
      OSVA_MCP_HOST: "127.0.0.1",
      OSVA_MCP_PORT: "0",
      OSVA_MCP_BEARER_TOKENS: `${MCP_TOKEN_A}:${WORKSPACE_A},${MCP_TOKEN_B}:${WORKSPACE_B}`,
    });

    try {
      await worker.start();
      await orchestrator.start();
      await mcp.start();
      const mcpPort = mcp.port;
      if (mcpPort === undefined) {
        throw new Error("MCP server did not bind a port.");
      }

      const mcpEndpoint = `http://127.0.0.1:${String(mcpPort)}/mcp`;
      const { agentId, agentVersionId } = await seedEchoAgent(
        webOrigin,
        WORKSPACE_A,
        trustedRuntimeRoot,
      );
      const { workflowVersionId, runIdInB } = await seedWorkflows(
        webOrigin,
        WORKSPACE_A,
        WORKSPACE_B,
        agentVersionId,
        trustedRuntimeRoot,
      );

      const clientA = await connectMcpClient(mcpEndpoint, MCP_TOKEN_A);

      const started = await clientA.callTool({
        name: OSVA_MCP_TOOL_NAMES.AGENT_RUN_V1,
        arguments: {
          agentId,
          agentVersionId,
          input: { hello: "mcp-inbound" },
        },
      });
      const startedPayload = parseStructured(started);
      const runId = String(startedPayload.runId);

      await waitUntil(async () => {
        const status = await clientA.callTool({
          name: OSVA_MCP_TOOL_NAMES.RUN_GET_V1,
          arguments: { runId },
        });
        return parseStructured(status).status === "SUCCEEDED";
      });

      const terminal = parseStructured(
        await clientA.callTool({
          name: OSVA_MCP_TOOL_NAMES.RUN_GET_V1,
          arguments: { runId },
        }),
      );
      expect(terminal.status).toBe("SUCCEEDED");
      expect(terminal.output).toMatchObject({
        echoed: { hello: "mcp-inbound" },
      });

      const workflowStarted = parseStructured(
        await clientA.callTool({
          name: OSVA_MCP_TOOL_NAMES.WORKFLOW_RUN_V1,
          arguments: {
            workflowVersionId,
            input: { topic: "mcp-workflow" },
          },
        }),
      );
      const workflowRunId = String(workflowStarted.workflowRunId);

      await waitUntil(async () => {
        const status = await clientA.callTool({
          name: OSVA_MCP_TOOL_NAMES.WORKFLOW_RUN_GET_V1,
          arguments: { workflowRunId },
        });
        const payload = parseStructured(status);
        return payload.status === "SUCCEEDED" || payload.status === "FAILED";
      });

      const workflowTerminal = parseStructured(
        await clientA.callTool({
          name: OSVA_MCP_TOOL_NAMES.WORKFLOW_RUN_GET_V1,
          arguments: { workflowRunId },
        }),
      );
      expect(workflowTerminal.workflowRunId).toBe(workflowRunId);

      const crossWorkspaceRun = await clientA.callTool({
        name: OSVA_MCP_TOOL_NAMES.RUN_GET_V1,
        arguments: { runId: runIdInB },
      });
      expect(crossWorkspaceRun.isError).toBe(true);

      const resources = await clientA.listResources();
      const uris = resources.resources.map((resource) => resource.uri);
      expect(uris.some((uri) => uri.includes("osva://v1/agents"))).toBe(true);

      await clientA.close();
    } finally {
      await mcp.stop();
      await orchestrator.stop();
      await worker.stop();
      await web.stop();
    }
  });
});

async function connectMcpClient(endpointUrl: string, token: string) {
  const client = new Client({ name: "mcp-server-e2e", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(endpointUrl), {
    requestInit: {
      headers: {
        authorization: `Bearer ${token}`,
      },
    },
  });
  await client.connect(transport);
  return client;
}

function parseStructured(result: {
  structuredContent?: unknown;
  content?: unknown;
}): Record<string, unknown> {
  if (
    result.structuredContent !== undefined &&
    result.structuredContent !== null &&
    typeof result.structuredContent === "object"
  ) {
    return result.structuredContent as Record<string, unknown>;
  }

  const textBlock = (
    result.content as Array<{ text?: string }> | undefined
  )?.[0]?.text;
  if (textBlock === undefined) {
    throw new Error("MCP tool result did not include structured content.");
  }
  return JSON.parse(textBlock) as Record<string, unknown>;
}

async function seedEchoAgent(
  origin: string,
  workspaceId: WorkspaceId,
  trustedRuntimeRoot: string,
) {
  const integrity = sha256IntegrityOf(
    await fs.readFile(path.join(trustedRuntimeRoot, "echo-agent.ts")),
  );
  const agent = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: {
      workspaceId,
      key: "echo",
      name: "Echo",
    },
  });
  const agentId = (agent.body as { id: string }).id;
  const version = await fetchJson(`${origin}/v1/agents/${agentId}/versions`, {
    method: "POST",
    body: {
      manifest: {
        schemaVersion: "1",
        key: "echo",
        name: "Echo",
        runtime: {
          type: "TRUSTED_TYPESCRIPT",
          entrypoint: "echo-agent.ts",
          integrity,
        },
        input: { schema: {} },
        output: { schema: {} },
        execution: { timeoutMs: 10_000, maxAttempts: 1 },
        capabilities: { model: false, tools: [] },
      },
    },
  });
  return {
    agentId,
    agentVersionId: (version.body as { id: string }).id,
  };
}

async function seedWorkflows(
  origin: string,
  workspaceA: WorkspaceId,
  workspaceB: WorkspaceId,
  agentVersionId: string,
  trustedRuntimeRoot: string,
) {
  const workflowA = await fetchJson(`${origin}/v1/workflows`, {
    method: "POST",
    body: {
      workspaceId: workspaceA,
      key: "wf-a",
      name: "Workflow A",
    },
  });
  const workflowAId = (workflowA.body as { id: string }).id;
  const workflowAVersion = await fetchJson(
    `${origin}/v1/workflows/${workflowAId}/versions`,
    {
      method: "POST",
      body: {
        definition: {
          schemaVersion: "1",
          nodes: [
            {
              key: "echo",
              type: "AGENT",
              agentVersionId,
            },
          ],
          edges: [],
        },
      },
    },
  );
  const workflowVersionId = (workflowAVersion.body as { id: string }).id;

  const { agentId: agentIdB, agentVersionId: agentVersionIdB } =
    await seedEchoAgent(origin, workspaceB, trustedRuntimeRoot);
  const runB = await fetchJson(`${origin}/v1/runs`, {
    method: "POST",
    body: {
      workspaceId: workspaceB,
      agentId: agentIdB,
      agentVersionId: agentVersionIdB,
      input: { secret: true },
    },
  });

  return {
    workflowVersionId,
    runIdInB: (runB.body as { run: { id: string } }).run.id,
  };
}

async function copyAgentFixture(file: string) {
  const trustedRuntimeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "osva-mcp-server-e2e-"),
  );
  await fs.copyFile(
    path.join(FIXTURE_DIR, file),
    path.join(trustedRuntimeRoot, file),
  );
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
  timeoutMs = 60_000,
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
