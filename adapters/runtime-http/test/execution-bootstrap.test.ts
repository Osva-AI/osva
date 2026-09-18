import type { RunAttemptId } from "@osva/contracts";
import {
  MemoryAgentRepository,
  MemoryRunRepository,
} from "@osva/adapters-memory";
import {
  Agent,
  AgentVersion,
  EffectiveRunBindings,
  Run,
  RunAttempt,
} from "@osva/domain";
import {
  RUNTIME_CAPABILITY_PATHS,
  RUNTIME_PROTOCOL_ERROR_CODES,
  RUNTIME_PROTOCOL_VERSION,
  runtimeExecuteRequestSchema,
} from "@osva/runtime-protocol";
import { describe, expect, it } from "vitest";

import { RuntimeCapabilityBridge } from "../src/capability-bridge.js";
import {
  CAPABILITY_TOKEN_SKEW_MS,
  issueBootstrapToken,
  issueCapabilityToken,
} from "../src/capability-token.js";
import { RuntimeExecutionBootstrapStore } from "../src/execution-bootstrap-store.js";
import { startRuntimeCapabilityServer } from "../src/capability-server.js";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const SECRET = "capability-secret";
const runAttemptId = "run-attempt-1" as RunAttemptId;

const validRequest = {
  protocolVersion: RUNTIME_PROTOCOL_VERSION,
  executionId: runAttemptId,
  input: { prompt: "hello" },
  capabilities: {
    endpoint: "http://127.0.0.1:8080",
    token: "capability-token-value",
  },
} as const;

function bootstrapUrl(executionId: string): string {
  return `${RUNTIME_CAPABILITY_PATHS.executionBootstrap}?executionId=${encodeURIComponent(executionId)}`;
}

async function seedRunningExecution() {
  const runs = new MemoryRunRepository();
  const agents = new MemoryAgentRepository();

  await agents.saveAgent(
    Agent.create({
      id: "agent-1" as never,
      workspaceId: "ws-1" as never,
      key: "container-agent",
      name: "Container Agent",
      createdAt: NOW,
    }),
  );
  await agents.saveAgentVersion(
    AgentVersion.create({
      id: "agent-version-1" as never,
      agentId: "agent-1" as never,
      version: 1,
      manifest: {
        schemaVersion: "1",
        key: "container-agent",
        name: "Container Agent",
        runtime: {
          type: "CONTAINER",
          protocolVersion: "1",
          image: `registry.example.com/agent@sha256:${"a".repeat(64)}`,
        },
        input: { schema: {} },
        output: { schema: {} },
        execution: { timeoutMs: 5_000, maxAttempts: 1 },
        capabilities: { model: false, tools: [] },
        models: {},
        tools: {},
      },
      createdAt: NOW,
    }),
  );

  const run = Run.create({
    id: "run-1" as never,
    workspaceId: "ws-1" as never,
    agentId: "agent-1" as never,
    effectiveBindings: EffectiveRunBindings.create({
      agentVersionId: "agent-version-1" as never,
      modelProfileVersionBindings: {},
      toolVersionBindings: {},
      memoryNamespaceBindings: {},
    }),
    input: {},
    createdAt: NOW,
  })
    .transitionTo("QUEUED", NOW)
    .transitionTo("RUNNING", NOW);

  const attempt = RunAttempt.createFirst({
    id: runAttemptId,
    runId: run.id,
    createdAt: NOW,
  }).transitionTo("RUNNING", NOW);

  await runs.saveRun(run);
  await runs.saveRunAttempt(attempt);

  return { runs, agents };
}

describe("execution bootstrap", () => {
  it("returns RuntimeExecuteRequest V1 for a valid bootstrap token", async () => {
    const store = new RuntimeExecutionBootstrapStore();
    const { runs, agents } = await seedRunningExecution();
    const bridge = new RuntimeCapabilityBridge({
      secret: SECRET,
      runs,
      agents,
      executionBootstrap: store,
      clock: { now: () => NOW },
      createScopedModelGateway: () => undefined,
      createScopedToolGateway: () => undefined,
      createScopedMemoryGateway: () => undefined,
    });

    const exp = NOW.getTime() + 5_000 + CAPABILITY_TOKEN_SKEW_MS;
    store.register(runAttemptId, validRequest, exp);
    const token = issueBootstrapToken(SECRET, {
      executionId: runAttemptId,
      exp,
    });

    const server = await startRuntimeCapabilityServer({
      handler: bridge.handle,
    });

    try {
      const response = await fetch(
        `${server.origin}${bootstrapUrl(runAttemptId)}`,
        {
          headers: { authorization: `Bearer ${token}` },
        },
      );
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      expect(runtimeExecuteRequestSchema.parse(body)).toEqual(validRequest);
    } finally {
      await server.close();
    }
  });

  it("rejects wrong execution id in the query string", async () => {
    const store = new RuntimeExecutionBootstrapStore();
    const { runs, agents } = await seedRunningExecution();
    const bridge = new RuntimeCapabilityBridge({
      secret: SECRET,
      runs,
      agents,
      executionBootstrap: store,
      clock: { now: () => NOW },
      createScopedModelGateway: () => undefined,
      createScopedToolGateway: () => undefined,
      createScopedMemoryGateway: () => undefined,
    });

    const exp = NOW.getTime() + 5_000;
    store.register(runAttemptId, validRequest, exp);
    const token = issueBootstrapToken(SECRET, {
      executionId: runAttemptId,
      exp,
    });

    const response = await bridge.handle({
      method: "GET",
      pathname: RUNTIME_CAPABILITY_PATHS.executionBootstrap,
      searchParams: new URLSearchParams({ executionId: "other-execution" }),
      authorization: `Bearer ${token}`,
      body: undefined,
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: { code: RUNTIME_PROTOCOL_ERROR_CODES.CAPABILITY_UNAUTHORIZED },
    });
  });

  it("rejects expired bootstrap tokens", async () => {
    const store = new RuntimeExecutionBootstrapStore();
    const { runs, agents } = await seedRunningExecution();
    const expired = new Date("2026-01-15T12:00:10.000Z");
    const bridge = new RuntimeCapabilityBridge({
      secret: SECRET,
      runs,
      agents,
      executionBootstrap: store,
      clock: { now: () => expired },
      createScopedModelGateway: () => undefined,
      createScopedToolGateway: () => undefined,
      createScopedMemoryGateway: () => undefined,
    });

    const exp = NOW.getTime() + 1_000;
    store.register(runAttemptId, validRequest, exp);
    const token = issueBootstrapToken(SECRET, {
      executionId: runAttemptId,
      exp,
    });

    const response = await bridge.handle({
      method: "GET",
      pathname: RUNTIME_CAPABILITY_PATHS.executionBootstrap,
      searchParams: new URLSearchParams({ executionId: runAttemptId }),
      authorization: `Bearer ${token}`,
      body: undefined,
    });

    expect(response.status).toBe(401);
  });

  it("rejects capability tokens on the bootstrap endpoint", async () => {
    const store = new RuntimeExecutionBootstrapStore();
    const { runs, agents } = await seedRunningExecution();
    const bridge = new RuntimeCapabilityBridge({
      secret: SECRET,
      runs,
      agents,
      executionBootstrap: store,
      clock: { now: () => NOW },
      createScopedModelGateway: () => undefined,
      createScopedToolGateway: () => undefined,
      createScopedMemoryGateway: () => undefined,
    });

    const exp = NOW.getTime() + 5_000;
    store.register(runAttemptId, validRequest, exp);
    const capabilityToken = issueCapabilityToken(SECRET, {
      executionId: runAttemptId,
      workspaceId: "ws-1",
      runId: "run-1",
      exp,
    });

    const response = await bridge.handle({
      method: "GET",
      pathname: RUNTIME_CAPABILITY_PATHS.executionBootstrap,
      searchParams: new URLSearchParams({ executionId: runAttemptId }),
      authorization: `Bearer ${capabilityToken}`,
      body: undefined,
    });

    expect(response.status).toBe(401);
  });

  it("allows only single retrieval per execution bootstrap registration", async () => {
    const store = new RuntimeExecutionBootstrapStore();
    const { runs, agents } = await seedRunningExecution();
    const bridge = new RuntimeCapabilityBridge({
      secret: SECRET,
      runs,
      agents,
      executionBootstrap: store,
      clock: { now: () => NOW },
      createScopedModelGateway: () => undefined,
      createScopedToolGateway: () => undefined,
      createScopedMemoryGateway: () => undefined,
    });

    const exp = NOW.getTime() + 5_000;
    store.register(runAttemptId, validRequest, exp);
    const token = issueBootstrapToken(SECRET, {
      executionId: runAttemptId,
      exp,
    });

    const first = await bridge.handle({
      method: "GET",
      pathname: RUNTIME_CAPABILITY_PATHS.executionBootstrap,
      searchParams: new URLSearchParams({ executionId: runAttemptId }),
      authorization: `Bearer ${token}`,
      body: undefined,
    });
    expect(first.status).toBe(200);

    const second = await bridge.handle({
      method: "GET",
      pathname: RUNTIME_CAPABILITY_PATHS.executionBootstrap,
      searchParams: new URLSearchParams({ executionId: runAttemptId }),
      authorization: `Bearer ${token}`,
      body: undefined,
    });
    expect(second.status).toBe(403);
  });

  it("does not log bootstrap tokens or RuntimeExecuteRequest payloads", async () => {
    const store = new RuntimeExecutionBootstrapStore();
    const { runs, agents } = await seedRunningExecution();
    const logs: Array<{
      event: string;
      fields?: Readonly<Record<string, unknown>>;
    }> = [];
    const bridge = new RuntimeCapabilityBridge({
      secret: SECRET,
      runs,
      agents,
      executionBootstrap: store,
      clock: { now: () => NOW },
      logger: {
        info(event, fields) {
          logs.push({ event, fields });
        },
        error() {
          return;
        },
      },
      createScopedModelGateway: () => undefined,
      createScopedToolGateway: () => undefined,
      createScopedMemoryGateway: () => undefined,
    });

    const exp = NOW.getTime() + 5_000;
    store.register(runAttemptId, validRequest, exp);
    const token = issueBootstrapToken(SECRET, {
      executionId: runAttemptId,
      exp,
    });

    await bridge.handle({
      method: "GET",
      pathname: RUNTIME_CAPABILITY_PATHS.executionBootstrap,
      searchParams: new URLSearchParams({ executionId: runAttemptId }),
      authorization: `Bearer ${token}`,
      body: undefined,
    });

    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain("capability-token-value");
    expect(serialized).not.toContain('"input"');
    expect(
      logs.some(
        (entry) => entry.event === "runtime.execution_bootstrap.delivered",
      ),
    ).toBe(true);
  });
});
