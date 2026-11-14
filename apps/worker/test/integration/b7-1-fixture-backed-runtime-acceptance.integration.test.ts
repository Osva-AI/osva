import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";
import { withTestAuthEnv } from "../../../../packages/db/test/integration/web-auth-env.js";

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
import {
  B7_1_FIXTURE_WORKSPACE,
  B7_1_STDIO_WEB_ENV,
  B7_1_STDIO_WORKER_ENV,
  agentIntegrity,
  assertToolRunStep,
  buildStdioTransportConfig,
  copyAgentFixtures,
  createAndAwaitRun,
  createTrustedTypescriptAgent,
  ensureFakeStdioMcpBuilt,
  importMcpTools,
  loadRunSteps,
  registerStdioConnectorVersion,
  resolveFakeStdioMcpEntry,
  seedStdioFakeEchoTool,
} from "./b7-1-stdio-runtime-harness.js";

const NOW = new Date("2026-01-20T12:00:00.000Z");

describe("FIXTURE_BACKED_RUNTIME_ACCEPTANCE — MCP STDIO via real web + worker", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;

  beforeAll(async () => {
    await ensureFakeStdioMcpBuilt();
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
  }, 300_000);

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
  }, 300_000);

  beforeEach(async () => {
    await resetStage0Tables(database);
    await bootstrapIntegrationAuth(database, B7_1_FIXTURE_WORKSPACE, NOW);
  });

  it("executes an imported MCP echo tool through ToolGateway with a persisted TOOL RunStep", async () => {
    const stdioEntry = resolveFakeStdioMcpEntry();
    const trustedRuntimeRoot = await copyAgentFixtures("mcp-echo-agent.ts");
    const integrity = await agentIntegrity(
      trustedRuntimeRoot,
      "mcp-echo-agent.ts",
    );

    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
        ...B7_1_STDIO_WEB_ENV,
      }),
    );
    const worker = createWorkerProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      ...B7_1_STDIO_WORKER_ENV,
    });

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const toolVersionId = await seedStdioFakeEchoTool({
        origin,
        stdioEntry,
      });
      const agents = await createTrustedTypescriptAgent({
        origin,
        agentKey: "b7-1-stdio-echo",
        agentName: "B7.1 STDIO Echo",
        entrypoint: "mcp-echo-agent.ts",
        integrity,
        toolBindings: { echo: { toolVersionId } },
      });

      const run = await createAndAwaitRun({
        origin,
        agentId: agents.agentId,
        agentVersionId: agents.agentVersionId,
        runInput: { hello: "b7-1-fixture" },
      });
      expect(run.terminalStatus).toBe("SUCCEEDED");

      const attempt = await fetchJson(
        `${origin}/v1/runs/${run.runId}/attempts/${run.runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({ status: "SUCCEEDED" });

      const frozen = await fetchJson(`${origin}/v1/runs/${run.runId}`);
      expect(
        (
          frozen.body as {
            effectiveBindings?: { toolVersionBindings?: unknown };
          }
        ).effectiveBindings?.toolVersionBindings,
      ).toEqual({ echo: toolVersionId });

      const steps = await loadRunSteps(origin, run.runId, run.runAttemptId);
      const toolStep = assertToolRunStep({
        steps,
        toolVersionId,
        bindingName: "echo",
        status: "SUCCEEDED",
      });
      expect(toolStep.errorCode).toBeUndefined();
    } finally {
      await worker.stop();
      await web.stop();
    }
  }, 120_000);

  it("rejects STDIO connector version registration when the web operator gate is off", async () => {
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
        OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS: "true",
      }),
    );
    try {
      const port = await web.listen();
      const origin = `http://127.0.0.1:${String(port)}`;
      const connector = await fetchJson(`${origin}/v1/connectors`, {
        method: "POST",
        body: { key: "stdio-gate", name: "Gate" },
      });
      expect(connector.status).toBe(201);
      const denied = await fetchJson(
        `${origin}/v1/connectors/${(connector.body as { id: string }).id}/versions`,
        {
          method: "POST",
          body: {
            kind: "MCP",
            transport: "STDIO",
            transportConfig: buildStdioTransportConfig(
              resolveFakeStdioMcpEntry(),
            ),
          },
        },
      );
      expect(denied.status).toBe(403);
    } finally {
      await web.stop();
    }
  });

  it("fails tool execution when the worker STDIO gate is disabled", async () => {
    const stdioEntry = resolveFakeStdioMcpEntry();
    const trustedRuntimeRoot = await copyAgentFixtures("mcp-echo-agent.ts");
    const integrity = await agentIntegrity(
      trustedRuntimeRoot,
      "mcp-echo-agent.ts",
    );

    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
        ...B7_1_STDIO_WEB_ENV,
      }),
    );
    const worker = createWorkerProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS: "true",
    });

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const toolVersionId = await seedStdioFakeEchoTool({
        origin,
        stdioEntry,
      });
      const agents = await createTrustedTypescriptAgent({
        origin,
        agentKey: "b7-1-worker-gate-off",
        agentName: "B7.1 Worker Gate Off",
        entrypoint: "mcp-echo-agent.ts",
        integrity,
        toolBindings: { echo: { toolVersionId } },
      });
      const run = await createAndAwaitRun({
        origin,
        agentId: agents.agentId,
        agentVersionId: agents.agentVersionId,
        runInput: {},
      });
      expect(run.terminalStatus).toBe("FAILED");
      const steps = await loadRunSteps(origin, run.runId, run.runAttemptId);
      const failedTool = steps.find((step) => step.kind === "TOOL");
      expect(failedTool?.status).toBe("FAILED");
      expect(failedTool?.errorCode).toBeDefined();
    } finally {
      await worker.stop();
      await web.stop();
    }
  });

  it("does not invoke MCP when the agent calls an unbound logical tool", async () => {
    const stdioEntry = resolveFakeStdioMcpEntry();
    const trustedRuntimeRoot = await copyAgentFixtures(
      "mcp-unauthorized-agent.ts",
    );
    const integrity = await agentIntegrity(
      trustedRuntimeRoot,
      "mcp-unauthorized-agent.ts",
    );

    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
        ...B7_1_STDIO_WEB_ENV,
      }),
    );
    const worker = createWorkerProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      ...B7_1_STDIO_WORKER_ENV,
    });

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const toolVersionId = await seedStdioFakeEchoTool({
        origin,
        stdioEntry,
      });
      const agents = await createTrustedTypescriptAgent({
        origin,
        agentKey: "b7-1-unbound",
        agentName: "B7.1 Unbound",
        entrypoint: "mcp-unauthorized-agent.ts",
        integrity,
        toolBindings: { echo: { toolVersionId } },
      });
      const run = await createAndAwaitRun({
        origin,
        agentId: agents.agentId,
        agentVersionId: agents.agentVersionId,
        runInput: {},
      });
      expect(run.terminalStatus).toBe("SUCCEEDED");
      const attempt = await fetchJson(
        `${origin}/v1/runs/${run.runId}/attempts/${run.runAttemptId}`,
      );
      expect(attempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: {
          caught: true,
          code: "TOOL_BINDING_NOT_FOUND",
        },
      });
      const steps = await loadRunSteps(origin, run.runId, run.runAttemptId);
      expect(steps.some((step) => step.kind === "TOOL")).toBe(false);
    } finally {
      await worker.stop();
      await web.stop();
    }
  });

  it("surfaces MCP tool errors without leaking raw provider diagnostics in RunSteps", async () => {
    const stdioEntry = resolveFakeStdioMcpEntry();
    const trustedRuntimeRoot = await copyAgentFixtures(
      "mcp-stdio-error-agent.ts",
    );
    const integrity = await agentIntegrity(
      trustedRuntimeRoot,
      "mcp-stdio-error-agent.ts",
    );

    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
        ...B7_1_STDIO_WEB_ENV,
      }),
    );
    const worker = createWorkerProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      ...B7_1_STDIO_WORKER_ENV,
    });

    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const { connectorVersionId } = await registerStdioConnectorVersion({
        origin,
        connectorKey: "b7-1-error-fixture",
        connectorName: "B7.1 Error Fixture",
        transportConfig: buildStdioTransportConfig(stdioEntry),
      });
      const imported = await importMcpTools({
        origin,
        connectorVersionId,
        tools: [
          {
            remoteToolName: "error",
            toolKey: "mcp_error",
            toolName: "MCP Error",
          },
        ],
      });
      const toolVersionId = imported[0]!.toolVersionId;
      const agents = await createTrustedTypescriptAgent({
        origin,
        agentKey: "b7-1-mcp-error",
        agentName: "B7.1 MCP Error",
        entrypoint: "mcp-stdio-error-agent.ts",
        integrity,
        toolBindings: { mcp_error: { toolVersionId } },
      });
      const run = await createAndAwaitRun({
        origin,
        agentId: agents.agentId,
        agentVersionId: agents.agentVersionId,
        runInput: {},
      });
      expect(run.terminalStatus).toBe("SUCCEEDED");
      const steps = await loadRunSteps(origin, run.runId, run.runAttemptId);
      const toolStep = assertToolRunStep({
        steps,
        toolVersionId,
        bindingName: "mcp_error",
        status: "FAILED",
      });
      expect(toolStep.errorCode).toBeTruthy();
      expect(JSON.stringify(toolStep)).not.toContain(
        "intentional fake MCP tool error",
      );
    } finally {
      await worker.stop();
      await web.stop();
    }
  });

  it("does not discover tools when the STDIO entry path is missing", async () => {
    const missing = path.join(
      os.tmpdir(),
      `osva-b7-1-missing-${String(Date.now())}.js`,
    );
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
        ...B7_1_STDIO_WEB_ENV,
      }),
    );
    try {
      const port = await web.listen();
      const origin = `http://127.0.0.1:${String(port)}`;
      const { connectorId, connectorVersionId } =
        await registerStdioConnectorVersion({
          origin,
          connectorKey: "b7-1-missing-entry",
          connectorName: "B7.1 Missing Entry",
          transportConfig: buildStdioTransportConfig(missing),
        });
      const discovered = await fetchJson(
        `${origin}/v1/connectors/${connectorId}/versions/${connectorVersionId}/discover`,
        { method: "POST", body: {} },
      );
      expect(discovered.status).toBeGreaterThanOrEqual(400);
    } finally {
      await web.stop();
    }
  });
});
