import { randomUUID } from "node:crypto";

import type {
  AgentId,
  AgentVersionId,
  ModelProfileVersionId,
  RunAttemptId,
  RunId,
  ToolVersionId,
  WorkspaceId,
} from "@osva/contracts";
import {
  MemoryAgentRepository,
  MemoryModelProfileRepository,
  MemoryRunRepository,
  MemoryToolRepository,
} from "@osva/adapters-memory";
import {
  Agent,
  AgentVersion,
  EffectiveRunBindings,
  KnowledgeBindingNotFoundError,
  ModelProfile,
  ModelProfileVersion,
  Run,
  RunAttempt,
  Tool,
  ToolVersion,
} from "@osva/domain";
import { ModelGateway } from "@osva/model-gateway";
import { createRunStepRecorder } from "@osva/observability";
import { RUNTIME_CAPABILITY_PATHS } from "@osva/runtime-protocol";
import { DefaultToolPolicy, ToolGateway } from "@osva/tool-gateway";
import { describe, expect, it, vi } from "vitest";

import { RuntimeCapabilityBridge } from "../src/capability-bridge.js";
import { issueCapabilityToken } from "../src/capability-token.js";
import { startRuntimeCapabilityServer } from "../src/capability-server.js";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const LATER = new Date("2026-01-15T12:00:01.000Z");
const EVEN_LATER = new Date("2026-01-15T12:00:02.000Z");
const SECRET = "capability-secret";
const workspaceId = "ws-1" as WorkspaceId;
const otherWorkspaceId = "ws-2" as WorkspaceId;
const agentId = "agent-1" as AgentId;
const agentVersionId = "agent-version-1" as AgentVersionId;
const runId = "run-1" as RunId;
const runAttemptId = "run-attempt-1" as RunAttemptId;
const otherAttemptId = "run-attempt-2" as RunAttemptId;
const modelProfileVersionId = "mpv-1" as ModelProfileVersionId;
const toolVersionId = "tv-1" as ToolVersionId;

async function seedRunningExecution(options?: {
  readonly attemptId?: RunAttemptId;
  readonly workspaceId?: WorkspaceId;
  readonly succeedAttempt?: boolean;
  readonly knowledgeIndexBindings?: Readonly<
    Record<string, readonly import("@osva/contracts").KnowledgeIndexId[]>
  >;
}) {
  const runs = new MemoryRunRepository();
  const agents = new MemoryAgentRepository();
  const tools = new MemoryToolRepository();
  const modelProfiles = new MemoryModelProfileRepository();
  const attemptId = options?.attemptId ?? runAttemptId;
  const ws = options?.workspaceId ?? workspaceId;

  await agents.saveAgent(
    Agent.create({
      id: agentId,
      workspaceId: ws,
      key: "remote-agent",
      name: "Remote Agent",
      createdAt: NOW,
    }),
  );
  await agents.saveAgentVersion(
    AgentVersion.create({
      id: agentVersionId,
      agentId,
      version: 1,
      manifest: {
        schemaVersion: "1",
        key: "remote-agent",
        name: "Remote Agent",
        runtime: {
          type: "REMOTE_HTTP",
          protocolVersion: "1",
          endpoint: "https://runtime.example.com/execute",
        },
        input: { schema: {} },
        output: { schema: {} },
        execution: { timeoutMs: 5_000, maxAttempts: 1 },
        capabilities: { model: true, tools: ["echo"] },
        models: { primary: { modelProfileVersionId } },
        tools: { echo: { toolVersionId } },
      },
      createdAt: NOW,
    }),
  );

  const run = Run.create({
    id: runId,
    workspaceId: ws,
    agentId,
    effectiveBindings: EffectiveRunBindings.create({
      agentVersionId,
      modelProfileVersionBindings: { primary: modelProfileVersionId },
      toolVersionBindings: { echo: toolVersionId },
      memoryNamespaceBindings: {},
      knowledgeIndexBindings: options?.knowledgeIndexBindings ?? {},
    }),
    input: { prompt: "hello" },
    createdAt: NOW,
  })
    .transitionTo("QUEUED", LATER)
    .transitionTo("RUNNING", EVEN_LATER);

  let attempt = RunAttempt.createFirst({
    id: attemptId,
    runId,
    createdAt: NOW,
  }).transitionTo("RUNNING", EVEN_LATER);
  if (options?.succeedAttempt === true) {
    attempt = attempt.transitionTo("SUCCEEDED", EVEN_LATER, {
      output: { done: true },
    });
  }

  await runs.saveRun(run);
  await runs.saveRunAttempt(attempt);

  await modelProfiles.saveModelProfile(
    ModelProfile.create({
      id: "mp-1" as never,
      workspaceId: ws,
      key: "primary",
      name: "Primary",
      createdAt: NOW,
    }),
  );
  await modelProfiles.saveModelProfileVersion(
    ModelProfileVersion.create({
      id: modelProfileVersionId,
      modelProfileId: "mp-1" as never,
      version: 1,
      provider: "OPENAI",
      model: "gpt-test",
      pricing: {
        currency: "USD",
        inputUsdMicrosPerMillionTokens: 1_000_000,
        outputUsdMicrosPerMillionTokens: 2_000_000,
      },
      createdAt: NOW,
    }),
  );

  await tools.saveTool(
    Tool.create({
      id: "tool-1" as never,
      workspaceId: ws,
      key: "echo",
      name: "Echo",
      createdAt: NOW,
    }),
  );
  await tools.saveToolVersion(
    ToolVersion.create({
      id: toolVersionId,
      toolId: "tool-1" as never,
      version: 1,
      type: "INTERNAL",
      implementation: "OSVA_ECHO_V1",
      createdAt: NOW,
    }),
  );

  return { runs, agents, tools, modelProfiles };
}

function tokenFor(
  executionId: string,
  extra?: { workspaceId?: string; runId?: string; exp?: number },
): string {
  return issueCapabilityToken(SECRET, {
    executionId,
    workspaceId: extra?.workspaceId ?? workspaceId,
    runId: extra?.runId ?? runId,
    exp: extra?.exp ?? NOW.getTime() + 30_000,
  });
}

describe("RuntimeCapabilityBridge", () => {
  it("rejects invalid, expired, cross-execution, and cross-workspace credentials", async () => {
    const seeded = await seedRunningExecution();
    const logs: string[] = [];
    const bridge = new RuntimeCapabilityBridge({
      secret: SECRET,
      runs: seeded.runs,
      agents: seeded.agents,
      clock: { now: () => NOW },
      logger: {
        info(event, fields) {
          logs.push(JSON.stringify({ event, fields }));
        },
        error() {
          return;
        },
      },
      createScopedModelGateway: () => undefined,
      createScopedToolGateway: () => undefined,
      createScopedMemoryGateway: () => undefined,
      createScopedKnowledgeGateway: () => undefined,
    });
    const server = await startRuntimeCapabilityServer({
      handler: bridge.handle,
    });
    const valid = tokenFor(runAttemptId);

    try {
      const invalid = await invokeModel(
        server.origin,
        "not-a-token",
        runAttemptId,
      );
      expect(invalid.status).toBe(401);

      const expired = await invokeModel(
        server.origin,
        tokenFor(runAttemptId, { exp: NOW.getTime() }),
        runAttemptId,
      );
      expect(expired.status).toBe(401);

      const otherExecution = await invokeModel(
        server.origin,
        tokenFor(otherAttemptId),
        runAttemptId,
      );
      expect(otherExecution.status).toBe(403);

      const otherWorkspace = await invokeModel(
        server.origin,
        tokenFor(runAttemptId, { workspaceId: otherWorkspaceId }),
        runAttemptId,
      );
      expect(otherWorkspace.status).toBe(403);

      const malformed = await invokeModel(server.origin, valid, runAttemptId, {
        protocolVersion: "1",
        executionId: runAttemptId,
        bindingName: "primary",
      });
      expect(malformed.status).toBe(400);

      expect(logs.join("\n")).not.toContain(valid);
    } finally {
      await server.close();
    }
  });

  it("rejects a token after the RunAttempt leaves RUNNING", async () => {
    const seeded = await seedRunningExecution({ succeedAttempt: true });
    const bridge = new RuntimeCapabilityBridge({
      secret: SECRET,
      runs: seeded.runs,
      agents: seeded.agents,
      clock: { now: () => NOW },
      createScopedModelGateway: () => undefined,
      createScopedToolGateway: () => undefined,
      createScopedMemoryGateway: () => undefined,
      createScopedKnowledgeGateway: () => undefined,
    });
    const server = await startRuntimeCapabilityServer({
      handler: bridge.handle,
    });
    try {
      const response = await invokeModel(
        server.origin,
        tokenFor(runAttemptId),
        runAttemptId,
      );
      expect(response.status).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("invokes models through ModelGateway using immutable bindings", async () => {
    const seeded = await seedRunningExecution();
    const inner = {
      generateTextOutcome: vi.fn(async () => ({
        text: "remote-hello",
        usage: {
          inputTokens: 10,
          outputTokens: 4,
          totalTokens: 14,
        },
      })),
      generateText: vi.fn(),
    } as unknown as ModelGateway;

    const bridge = new RuntimeCapabilityBridge({
      secret: SECRET,
      runs: seeded.runs,
      agents: seeded.agents,
      clock: { now: () => NOW },
      createScopedModelGateway: (execution) =>
        createRunStepRecorder(execution, {
          runs: seeded.runs,
          modelProfiles: seeded.modelProfiles,
          clock: { now: () => NOW },
          ids: { createId: () => randomUUID() },
        }).wrapModelGateway(inner),
      createScopedToolGateway: () => undefined,
      createScopedMemoryGateway: () => undefined,
      createScopedKnowledgeGateway: () => undefined,
    });
    const server = await startRuntimeCapabilityServer({
      handler: bridge.handle,
    });

    try {
      const response = await invokeModel(
        server.origin,
        tokenFor(runAttemptId),
        runAttemptId,
      );
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        protocolVersion: "1",
        executionId: runAttemptId,
        outcome: "SUCCEEDED",
        result: { text: "remote-hello" },
      });
      expect(inner.generateTextOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          modelProfileVersionId,
        }),
        undefined,
      );

      const denied = await invokeModel(
        server.origin,
        tokenFor(runAttemptId),
        runAttemptId,
        {
          protocolVersion: "1",
          executionId: runAttemptId,
          bindingName: "other",
          input: { messages: [{ role: "user", content: "hi" }] },
        },
      );
      expect(denied.status).toBe(200);
      expect(denied.body).toMatchObject({
        outcome: "FAILED",
        error: { code: "MODEL_BINDING_NOT_FOUND" },
      });

      const steps = seeded.runs.snapshotRunSteps();
      expect(steps).toHaveLength(1);
      expect(steps[0]?.kind).toBe("MODEL");
      expect(steps[0]?.status).toBe("SUCCEEDED");
      expect(steps[0]?.inputTokens).toBe(10);
      expect(steps[0]?.estimatedCostUsdMicros).toBe(18);
      expect(JSON.stringify(steps[0])).not.toContain("hello from remote");
    } finally {
      await server.close();
    }
  });

  it("invokes tools through ToolGateway and rejects unbound tools", async () => {
    const seeded = await seedRunningExecution();
    const toolGateway = new ToolGateway({
      tools: seeded.tools,
      policy: new DefaultToolPolicy(),
    });
    const bridge = new RuntimeCapabilityBridge({
      secret: SECRET,
      runs: seeded.runs,
      agents: seeded.agents,
      clock: { now: () => NOW },
      createScopedModelGateway: () => undefined,
      createScopedToolGateway: (execution) =>
        createRunStepRecorder(execution, {
          runs: seeded.runs,
          modelProfiles: seeded.modelProfiles,
          clock: { now: () => NOW },
          ids: { createId: () => randomUUID() },
        }).wrapToolGateway(toolGateway),
      createScopedMemoryGateway: () => undefined,
      createScopedKnowledgeGateway: () => undefined,
    });
    const server = await startRuntimeCapabilityServer({
      handler: bridge.handle,
    });

    try {
      const response = await invokeTool(server.origin, tokenFor(runAttemptId), {
        protocolVersion: "1",
        executionId: runAttemptId,
        bindingName: "echo",
        input: { value: "remote-tool" },
        idempotencyKey: "side-effect-1",
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        outcome: "SUCCEEDED",
        output: { value: "remote-tool" },
      });

      const unbound = await invokeTool(server.origin, tokenFor(runAttemptId), {
        protocolVersion: "1",
        executionId: runAttemptId,
        bindingName: "other",
        input: {},
      });
      expect(unbound.body).toMatchObject({
        outcome: "FAILED",
        error: { code: "TOOL_BINDING_NOT_FOUND" },
      });

      const withVersionId = await invokeTool(
        server.origin,
        tokenFor(runAttemptId),
        {
          protocolVersion: "1",
          executionId: runAttemptId,
          bindingName: "echo",
          input: {},
          toolVersionId: "attacker-supplied",
        },
      );
      expect(withVersionId.status).toBe(400);

      const steps = seeded.runs.snapshotRunSteps();
      expect(
        steps.some(
          (step) => step.kind === "TOOL" && step.status === "SUCCEEDED",
        ),
      ).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("searches knowledge through the capability endpoint using frozen bindings", async () => {
    const indexId = "ki-frozen" as import("@osva/contracts").KnowledgeIndexId;
    const seeded = await seedRunningExecution({
      knowledgeIndexBindings: { company_docs: [indexId] },
    });

    const bridge = new RuntimeCapabilityBridge({
      secret: SECRET,
      runs: seeded.runs,
      agents: seeded.agents,
      clock: { now: () => NOW },
      createScopedModelGateway: () => undefined,
      createScopedToolGateway: () => undefined,
      createScopedMemoryGateway: () => undefined,
      createScopedKnowledgeGateway: (execution) =>
        createRunStepRecorder(execution, {
          runs: seeded.runs,
          modelProfiles: seeded.modelProfiles,
          clock: { now: () => NOW },
          ids: { createId: () => randomUUID() },
        }).wrapKnowledgeGateway({
          async search(exec, bindingName, request) {
            if (bindingName !== "company_docs") {
              throw new KnowledgeBindingNotFoundError(bindingName);
            }
            expect(exec.knowledgeIndexBindings.company_docs).toEqual([indexId]);
            expect(request.query).toBe("refund policy");
            return [
              {
                knowledgeChunkId: "chunk-1" as never,
                knowledgeIndexId: indexId,
                knowledgeSourceId: "ks-1" as never,
                artifactReference: {
                  type: "artifact",
                  artifactId: "art-1" as never,
                },
                text: "policy text",
                score: 0.9,
                attributes: {},
              },
            ];
          },
        }),
    });

    const server = await startRuntimeCapabilityServer({
      host: "127.0.0.1",
      port: 0,
      handler: bridge.handle,
    });

    try {
      const response = await fetch(
        `${server.origin}${RUNTIME_CAPABILITY_PATHS.knowledgeSearch}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${tokenFor(runAttemptId)}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            protocolVersion: "1",
            executionId: runAttemptId,
            bindingName: "company_docs",
            query: "refund policy",
            topK: 3,
          }),
        },
      );
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        outcome: "SUCCEEDED",
        hits: [{ text: "policy text", knowledgeIndexId: indexId }],
      });

      const unbound = await fetch(
        `${server.origin}${RUNTIME_CAPABILITY_PATHS.knowledgeSearch}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${tokenFor(runAttemptId)}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            protocolVersion: "1",
            executionId: runAttemptId,
            bindingName: "other",
            query: "x",
          }),
        },
      );
      expect((await unbound.json()) as { outcome: string }).toMatchObject({
        outcome: "FAILED",
        error: { code: "KNOWLEDGE_BINDING_NOT_FOUND" },
      });
    } finally {
      await server.close();
    }
  });
});

async function invokeModel(
  origin: string,
  token: string,
  executionId: string,
  body: unknown = {
    protocolVersion: "1",
    executionId,
    bindingName: "primary",
    input: { messages: [{ role: "user", content: "hi" }] },
  },
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(
    `${origin}${RUNTIME_CAPABILITY_PATHS.generateText}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  return { status: response.status, body: await response.json() };
}

async function invokeTool(
  origin: string,
  token: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(
    `${origin}${RUNTIME_CAPABILITY_PATHS.invokeTool}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  return { status: response.status, body: await response.json() };
}
