import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ToolVersionId } from "@osva-ai/contracts";
import type { Database } from "@osva/db";

import {
  assertNoSentinelLeak,
  consoleJson,
  resetM12_3Data,
  SENTINEL_CREDENTIAL,
  startM12_3HumanConsoleStack,
  startM12_3Infra,
  stopM12_3Infra,
  waitForRunSucceeded,
  type M12_3Stack,
} from "./m12-3-harness.js";
import type { PostgresTestContext } from "../../../../packages/db/test/integration/postgres-harness.js";
import type { ValkeyTestContext } from "../../../../adapters/bullmq/test/integration/valkey-harness.js";

describe("M12.3 cross-capability acceptance (Console BFF + real stack)", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;

  beforeAll(async () => {
    ({ postgres, valkey, database } = await startM12_3Infra());
  }, 180_000);

  afterAll(async () => {
    await stopM12_3Infra(database, postgres, valkey);
  });

  beforeEach(async () => {
    await resetM12_3Data(database);
  });

  async function openStack(): Promise<M12_3Stack> {
    return startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });
  }

  it("scenario 1: model provider connection journey through Console BFF", async () => {
    const stack = await openStack();
    try {
      const connection = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/model-provider-connections",
        {
          method: "POST",
          body: {
            key: "fake-openai",
            name: "Fake OpenAI",
            provider: "OPENAI",
          },
        },
      );
      expect(connection.status).toBe(201);
      assertNoSentinelLeak(connection.text);
      const connectionId = (connection.body as { id: string }).id;

      const version = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/model-provider-connections/${encodeURIComponent(connectionId)}/versions`,
        {
          method: "POST",
          body: {
            endpoint: {
              baseUrl: stack.fakeOpenAI.origin,
              allowPrivateNetworks: true,
            },
            credentialRef: { key: "OPENAI_API_KEY" },
          },
        },
      );
      expect(version.status).toBe(201);
      assertNoSentinelLeak(version.text);
      expect(JSON.stringify(version.body)).not.toContain("credentialRef");
      const connectionVersionId = (version.body as { id: string }).id;

      const connectivity = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/model-provider-connections/${encodeURIComponent(connectionId)}/versions/${encodeURIComponent(connectionVersionId)}/test`,
        {
          method: "POST",
          body: { model: "gpt-m12-3-test" },
        },
      );
      expect(connectivity.status).toBe(200);
      assertNoSentinelLeak(connectivity.text);

      const profile = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/model-profiles",
        {
          method: "POST",
          body: { key: "primary", name: "Primary" },
        },
      );
      expect(profile.status).toBe(201);
      const modelProfileId = (profile.body as { id: string }).id;

      const mpv = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/model-profiles/${encodeURIComponent(modelProfileId)}/versions`,
        {
          method: "POST",
          body: {
            provider: "OPENAI",
            model: "gpt-m12-3-test",
            modelProviderConnectionVersionId: connectionVersionId,
          },
        },
      );
      expect(mpv.status).toBe(201);
      const modelProfileVersionId = (mpv.body as { id: string }).id;

      const integrity = await stack.copyAgentFixture("model-text-agent.ts");
      const agent = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/agents",
        {
          method: "POST",
          body: { key: "model-agent", name: "Model Agent" },
        },
      );
      expect(agent.status).toBe(201);
      const agentId = (agent.body as { id: string }).id;

      const agentVersion = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/agents/${encodeURIComponent(agentId)}/versions`,
        {
          method: "POST",
          body: {
            manifest: {
              schemaVersion: "1",
              key: "model-agent",
              name: "Model Agent",
              runtime: {
                type: "TRUSTED_TYPESCRIPT",
                entrypoint: "model-text-agent.ts",
                integrity,
              },
              input: { schema: {} },
              output: { schema: {} },
              execution: { timeoutMs: 30_000, maxAttempts: 1 },
              capabilities: { model: true, tools: [] },
              models: { primary: { modelProfileVersionId } },
            },
          },
        },
      );
      expect(agentVersion.status).toBe(201);
      const agentVersionId = (agentVersion.body as { id: string }).id;

      const run = await consoleJson(stack, stack.workspaceA, "/api/v1/runs", {
        method: "POST",
        body: { agentId, agentVersionId, input: {} },
      });
      expect(run.status).toBe(201);
      assertNoSentinelLeak(run.text);
      const runId = (run.body as { run: { id: string } }).run.id;
      const runAttemptId = (run.body as { runAttempt: { id: string } })
        .runAttempt.id;

      await waitForRunSucceeded(stack, stack.workspaceA, runId);

      const steps = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(runAttemptId)}/steps`,
      );
      expect(steps.status).toBe(200);
      assertNoSentinelLeak(steps.text);
      const stepKinds = (
        (steps.body as { steps: Array<{ kind: string }> }).steps ?? []
      ).map((step) => step.kind);
      expect(stepKinds).toContain("MODEL");
      expect(stack.fakeOpenAI.requests.length).toBeGreaterThan(0);
    } finally {
      await stack.close();
    }
  });

  it("scenario 2: MCP connector discover/import journey through Console BFF", async () => {
    const stack = await openStack();
    try {
      const connector = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/connectors",
        {
          method: "POST",
          body: { key: "fake-mcp", name: "Fake MCP" },
        },
      );
      expect(connector.status).toBe(201);
      const connectorId = (connector.body as { id: string }).id;

      const version = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/connectors/${encodeURIComponent(connectorId)}/versions`,
        {
          method: "POST",
          body: {
            kind: "MCP",
            transport: "STREAMABLE_HTTP",
            transportConfig: { endpointUrl: stack.fakeMcp.endpointUrl },
          },
        },
      );
      expect(version.status).toBe(201);
      assertNoSentinelLeak(version.text);
      const connectorVersionId = (version.body as { id: string }).id;

      const discover = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/connectors/${encodeURIComponent(connectorId)}/versions/${encodeURIComponent(connectorVersionId)}/discover`,
        { method: "POST", body: {} },
      );
      expect(discover.status).toBe(200);
      const remoteTools = (
        discover.body as { tools: Array<{ remoteToolName: string }> }
      ).tools;
      expect(remoteTools.some((tool) => tool.remoteToolName === "echo")).toBe(
        true,
      );

      const imported = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/connectors/import-mcp-tools",
        {
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
        },
      );
      expect(imported.status).toBe(200);
      const toolVersionId = (
        imported.body as {
          imported: Array<{ toolVersionId: ToolVersionId }>;
        }
      ).imported[0]?.toolVersionId;
      expect(toolVersionId).toBeTruthy();

      const integrity = await stack.copyAgentFixture("mcp-echo-agent.ts");
      const agent = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/agents",
        {
          method: "POST",
          body: { key: "mcp-agent", name: "MCP Agent" },
        },
      );
      const agentId = (agent.body as { id: string }).id;
      const agentVersion = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/agents/${encodeURIComponent(agentId)}/versions`,
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
              execution: { timeoutMs: 30_000, maxAttempts: 1 },
              capabilities: { model: false, tools: ["echo"] },
              tools: { echo: { toolVersionId } },
            },
          },
        },
      );
      expect(agentVersion.status).toBe(201);
      const agentVersionId = (agentVersion.body as { id: string }).id;

      const run = await consoleJson(stack, stack.workspaceA, "/api/v1/runs", {
        method: "POST",
        body: {
          agentId,
          agentVersionId,
          input: { hello: "m12-3-mcp" },
        },
      });
      expect(run.status).toBe(201);
      const runId = (run.body as { run: { id: string } }).run.id;
      const runAttemptId = (run.body as { runAttempt: { id: string } })
        .runAttempt.id;
      await waitForRunSucceeded(stack, stack.workspaceA, runId);
      expect(stack.fakeMcp.toolCallCount).toBeGreaterThan(0);

      const steps = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(runAttemptId)}/steps`,
      );
      const stepKinds = (
        (steps.body as { steps: Array<{ kind: string }> }).steps ?? []
      ).map((step) => step.kind);
      expect(stepKinds).toContain("TOOL");
    } finally {
      await stack.close();
    }
  });

  it("scenario 3: combined model and MCP tool execution", async () => {
    const stack = await openStack();
    try {
      const connection = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/model-provider-connections",
        {
          method: "POST",
          body: {
            key: "combined-openai",
            name: "Combined OpenAI",
            provider: "OPENAI",
          },
        },
      );
      const connectionId = (connection.body as { id: string }).id;
      const connectionVersion = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/model-provider-connections/${encodeURIComponent(connectionId)}/versions`,
        {
          method: "POST",
          body: {
            endpoint: {
              baseUrl: stack.fakeOpenAI.origin,
              allowPrivateNetworks: true,
            },
            credentialRef: { key: "OPENAI_API_KEY" },
          },
        },
      );
      const connectionVersionId = (connectionVersion.body as { id: string }).id;

      const profile = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/model-profiles",
        { method: "POST", body: { key: "primary", name: "Primary" } },
      );
      const modelProfileId = (profile.body as { id: string }).id;
      const mpv = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/model-profiles/${encodeURIComponent(modelProfileId)}/versions`,
        {
          method: "POST",
          body: {
            provider: "OPENAI",
            model: "gpt-combined",
            modelProviderConnectionVersionId: connectionVersionId,
          },
        },
      );
      const modelProfileVersionId = (mpv.body as { id: string }).id;

      const connector = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/connectors",
        {
          method: "POST",
          body: { key: "combined-mcp", name: "Combined MCP" },
        },
      );
      const connectorId = (connector.body as { id: string }).id;
      const connectorVersion = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/connectors/${encodeURIComponent(connectorId)}/versions`,
        {
          method: "POST",
          body: {
            kind: "MCP",
            transport: "STREAMABLE_HTTP",
            transportConfig: { endpointUrl: stack.fakeMcp.endpointUrl },
          },
        },
      );
      const connectorVersionId = (connectorVersion.body as { id: string }).id;
      const imported = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/connectors/import-mcp-tools",
        {
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
        },
      );
      const toolVersionId = (
        imported.body as {
          imported: Array<{ toolVersionId: ToolVersionId }>;
        }
      ).imported[0]?.toolVersionId;

      stack.fakeMcp.resetToolCallCount();
      const openAiBefore = stack.fakeOpenAI.requests.length;

      const integrity = await stack.copyAgentFixture(
        "model-tool-combined-agent.ts",
      );
      const agent = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/agents",
        {
          method: "POST",
          body: { key: "combined-agent", name: "Combined Agent" },
        },
      );
      const agentId = (agent.body as { id: string }).id;
      const agentVersion = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/agents/${encodeURIComponent(agentId)}/versions`,
        {
          method: "POST",
          body: {
            manifest: {
              schemaVersion: "1",
              key: "combined-agent",
              name: "Combined Agent",
              runtime: {
                type: "TRUSTED_TYPESCRIPT",
                entrypoint: "model-tool-combined-agent.ts",
                integrity,
              },
              input: { schema: {} },
              output: { schema: {} },
              execution: { timeoutMs: 45_000, maxAttempts: 1 },
              capabilities: { model: true, tools: ["echo"] },
              models: { primary: { modelProfileVersionId } },
              tools: { echo: { toolVersionId } },
            },
          },
        },
      );
      const agentVersionId = (agentVersion.body as { id: string }).id;

      const run = await consoleJson(stack, stack.workspaceA, "/api/v1/runs", {
        method: "POST",
        body: {
          agentId,
          agentVersionId,
          input: { combined: true },
        },
      });
      const runId = (run.body as { run: { id: string } }).run.id;
      const runAttemptId = (run.body as { runAttempt: { id: string } })
        .runAttempt.id;
      await waitForRunSucceeded(stack, stack.workspaceA, runId);

      expect(stack.fakeOpenAI.requests.length).toBeGreaterThan(openAiBefore);
      expect(stack.fakeMcp.toolCallCount).toBeGreaterThan(0);

      const steps = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(runAttemptId)}/steps`,
      );
      const stepKinds = (
        (steps.body as { steps: Array<{ kind: string }> }).steps ?? []
      ).map((step) => step.kind);
      expect(stepKinds).toContain("MODEL");
      expect(stepKinds).toContain("TOOL");
    } finally {
      await stack.close();
    }
  });

  it("scenario 4: workspace isolation for capability resources", async () => {
    const stack = await openStack();
    try {
      const connection = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/model-provider-connections",
        {
          method: "POST",
          body: {
            key: "ws-a-only",
            name: "WS A",
            provider: "OPENAI",
          },
        },
      );
      const connectionId = (connection.body as { id: string }).id;

      const listB = await consoleJson(
        stack,
        stack.workspaceB,
        "/api/v1/model-provider-connections",
      );
      expect(listB.status).toBe(200);
      const idsB = (
        (listB.body as { connections: Array<{ id: string }> }).connections ?? []
      ).map((entry) => entry.id);
      expect(idsB).not.toContain(connectionId);

      const foreignGet = await consoleJson(
        stack,
        stack.workspaceB,
        `/api/v1/model-provider-connections/${encodeURIComponent(connectionId)}`,
      );
      expect([403, 404]).toContain(foreignGet.status);

      const connector = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/connectors",
        {
          method: "POST",
          body: { key: "ws-a-connector", name: "WS A Connector" },
        },
      );
      const connectorId = (connector.body as { id: string }).id;
      const connectorsB = await consoleJson(
        stack,
        stack.workspaceB,
        "/api/v1/connectors",
      );
      const connectorIdsB = (
        (connectorsB.body as { connectors: Array<{ id: string }> })
          .connectors ?? []
      ).map((entry) => entry.id);
      expect(connectorIdsB).not.toContain(connectorId);

      const staleWorkspaceRun = await consoleJson(
        stack,
        stack.workspaceB,
        "/api/v1/runs",
        {
          method: "POST",
          body: {
            agentId: "agent-does-not-exist",
            agentVersionId: "av-does-not-exist",
            input: {},
          },
        },
      );
      expect(staleWorkspaceRun.status).toBeGreaterThanOrEqual(400);
    } finally {
      await stack.close();
    }
  });

  it("security: credential redaction and adversarial tool boundaries", async () => {
    const stack = await openStack();
    try {
      const connection = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/model-provider-connections",
        {
          method: "POST",
          body: {
            key: "ssrf-test",
            name: "SSRF",
            provider: "OPENAI",
          },
        },
      );
      expect(connection.status).toBe(201);
      const connector = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/connectors",
        {
          method: "POST",
          body: { key: "mcp-adv", name: "MCP Adv" },
        },
      );
      const connectorId = (connector.body as { id: string }).id;
      const connectorVersion = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/connectors/${encodeURIComponent(connectorId)}/versions`,
        {
          method: "POST",
          body: {
            kind: "MCP",
            transport: "STREAMABLE_HTTP",
            transportConfig: { endpointUrl: stack.fakeMcp.endpointUrl },
          },
        },
      );
      const connectorVersionId = (connectorVersion.body as { id: string }).id;
      const imported = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/connectors/import-mcp-tools",
        {
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
        },
      );
      const toolVersionId = (
        imported.body as {
          imported: Array<{ toolVersionId: ToolVersionId }>;
        }
      ).imported[0]?.toolVersionId;

      const integrity = await stack.copyAgentFixture(
        "mcp-adversarial-agent.ts",
      );
      const agent = await consoleJson(
        stack,
        stack.workspaceA,
        "/api/v1/agents",
        {
          method: "POST",
          body: { key: "adv-agent", name: "Adv Agent" },
        },
      );
      const agentId = (agent.body as { id: string }).id;
      const agentVersion = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/agents/${encodeURIComponent(agentId)}/versions`,
        {
          method: "POST",
          body: {
            manifest: {
              schemaVersion: "1",
              key: "adv-agent",
              name: "Adv Agent",
              runtime: {
                type: "TRUSTED_TYPESCRIPT",
                entrypoint: "mcp-adversarial-agent.ts",
                integrity,
              },
              input: { schema: {} },
              output: { schema: {} },
              execution: { timeoutMs: 30_000, maxAttempts: 1 },
              capabilities: { model: false, tools: ["echo"] },
              tools: { echo: { toolVersionId } },
            },
          },
        },
      );
      const agentVersionId = (agentVersion.body as { id: string }).id;
      const run = await consoleJson(stack, stack.workspaceA, "/api/v1/runs", {
        method: "POST",
        body: { agentId, agentVersionId, input: {} },
      });
      const runId = (run.body as { run: { id: string } }).run.id;
      await waitForRunSucceeded(stack, stack.workspaceA, runId);

      const attempt = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent((run.body as { runAttempt: { id: string } }).runAttempt.id)}`,
      );
      assertNoSentinelLeak(attempt.text);
      expect(JSON.stringify(attempt.body)).not.toContain(SENTINEL_CREDENTIAL);
      expect(
        (attempt.body as { output?: { caught?: boolean } }).output,
      ).toMatchObject({ caught: true });
      expect(stack.fakeMcp.toolCallCount).toBe(1);
    } finally {
      await stack.close();
    }
  });
});
