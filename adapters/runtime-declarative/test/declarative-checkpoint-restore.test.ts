import type {
  CommitRunCheckpointCommand,
  CommitRunCheckpointResult,
  ExecutionRequest,
  GenerateCompletionResult,
  JsonSchemaRecord,
  JsonValue,
  RunCheckpointPort,
} from "@osva-ai/contracts";
import {
  DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION,
  type DeclarativeRuntimeCheckpointStateV1,
} from "@osva-ai/contracts";
import { MemoryRunCheckpointRepository } from "@osva/adapters-memory";
import { describe, expect, it, vi } from "vitest";

import {
  AGENT_OUTPUT_SCHEMA_EFFECTIVE_CONFIG_KEY,
  DeclarativeRuntimeAdapter,
} from "../src/index.js";

const outputSchema: JsonSchemaRecord = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
};

function checkpointEnabledRequest(
  overrides: Partial<ExecutionRequest> = {},
  repository?: MemoryRunCheckpointRepository,
): ExecutionRequest {
  const repo = repository ?? new MemoryRunCheckpointRepository();
  repo.trackRunningAttempt({
    runAttemptId: "attempt-1",
    owner: "worker-1",
    generation: 1,
  });

  const port: RunCheckpointPort = {
    commit: (command) => repo.commit(command),
  };

  return {
    runId: "run-1" as ExecutionRequest["runId"],
    runAttemptId: "attempt-1" as ExecutionRequest["runAttemptId"],
    workspaceId: "ws-1" as ExecutionRequest["workspaceId"],
    agentId: "agent-1" as ExecutionRequest["agentId"],
    agentVersionId: "av-1" as ExecutionRequest["agentVersionId"],
    runtime: {
      type: "DECLARATIVE",
      config: {
        configVersion: "1",
        instructions: "You are a test agent.",
        modelBinding: "primary",
        allowedToolBindings: ["echo"],
        maxModelInvocations: 4,
        maxToolInvocations: 4,
        maxOutputTokens: 256,
        checkpointingEnabled: true,
      },
    },
    input: { question: "hello" },
    effectiveConfig: {
      [AGENT_OUTPUT_SCHEMA_EFFECTIVE_CONFIG_KEY]: outputSchema,
    },
    modelProfileVersionBindings: {
      primary:
        "mpv-1" as ExecutionRequest["modelProfileVersionBindings"][string],
    },
    toolVersionBindings: {
      echo: "tv-1" as ExecutionRequest["toolVersionBindings"][string],
    },
    memoryNamespaceBindings: {},
    knowledgeIndexBindings: {},
    toolGrants: [],
    timeoutMs: 5_000,
    policyContext: {},
    checkpoint: { port },
    executionOwnership: { owner: "worker-1", generation: 1 },
    ...overrides,
  };
}

describe("Declarative checkpoint restore", () => {
  it("persists multiple checkpoints during model/tool execution", async () => {
    const repository = new MemoryRunCheckpointRepository();
    let modelCalls = 0;

    const adapter = new DeclarativeRuntimeAdapter({
      modelGateway: {
        generateCompletion: vi.fn(
          async (): Promise<GenerateCompletionResult> => {
            modelCalls += 1;
            if (modelCalls === 1) {
              return {
                toolCalls: [
                  { id: "c1", name: "echo", arguments: { value: "a" } },
                ],
                finishReason: "tool_call",
              };
            }
            return {
              text: JSON.stringify({ answer: "done" }),
              toolCalls: [],
              finishReason: "stop" as const,
            };
          },
        ),
      },
      toolGateway: {
        invoke: vi.fn(async () => ({ ok: true })),
      },
      resolveToolMetadata: vi.fn(async () => ({
        inputSchema: {
          type: "object",
          properties: { value: {} },
          required: ["value"],
          additionalProperties: false,
        },
        idempotencyClass: "PURE" as const,
      })),
    });

    const request = checkpointEnabledRequest({}, repository);
    await expect(adapter.execute(request)).resolves.toEqual({
      status: "succeeded",
      output: { answer: "done" },
    });

    const listed = await repository.list({
      workspaceId: request.workspaceId,
      runId: request.runId,
      limit: 20,
    });
    expect(listed.checkpoints.length).toBeGreaterThanOrEqual(3);
    expect(
      listed.checkpoints.some((row) => row.cursor.phase === "after_model"),
    ).toBe(true);
    expect(
      listed.checkpoints.some((row) => row.cursor.phase === "after_tool"),
    ).toBe(true);
  });

  it("restores pending tool calls in a new adapter without replaying committed tools", async () => {
    const repository = new MemoryRunCheckpointRepository();
    repository.trackRunningAttempt({
      runAttemptId: "attempt-2",
      owner: "worker-2",
      generation: 1,
    });

    let modelCalls = 0;
    let toolCalls = 0;

    const restoreState: DeclarativeRuntimeCheckpointStateV1 = {
      schemaVersion: DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION,
      messages: [
        { role: "system", content: "test" },
        { role: "user", content: "input" },
        { role: "assistant", content: "Requested tools: echo, echo" },
        {
          role: "tool",
          toolCallId: "c1",
          name: "echo",
          content: JSON.stringify({ value: "a" }),
        },
      ],
      modelInvocations: 1,
      toolInvocations: 1,
      pendingToolCalls: [
        { id: "c2", name: "echo", arguments: { value: "b" } as JsonValue },
      ],
    };

    const adapter = new DeclarativeRuntimeAdapter({
      modelGateway: {
        generateCompletion: vi.fn(async () => {
          modelCalls += 1;
          return {
            text: JSON.stringify({ answer: "done" }),
            toolCalls: [],
            finishReason: "stop" as const,
          };
        }),
      },
      toolGateway: {
        invoke: vi.fn(async (invokeRequest) => {
          toolCalls += 1;
          expect(invokeRequest.input).toEqual({ value: "b" });
          return { value: "b" };
        }),
      },
      resolveToolMetadata: vi.fn(async () => ({
        inputSchema: {
          type: "object",
          properties: { value: {} },
          required: ["value"],
          additionalProperties: false,
        },
        idempotencyClass: "PURE" as const,
      })),
    });

    const request = checkpointEnabledRequest(
      {
        runAttemptId: "attempt-2" as ExecutionRequest["runAttemptId"],
        executionOwnership: { owner: "worker-2", generation: 1 },
        checkpoint: {
          port: { commit: (command) => repository.commit(command) },
          restore: restoreState,
        },
      },
      repository,
    );

    const result = await adapter.execute(request);
    expect(result).toEqual({ status: "succeeded", output: { answer: "done" } });
    expect(toolCalls).toBe(1);
    expect(modelCalls).toBe(1);
    expect(restoreState.messages.filter((m) => m.role === "tool")).toHaveLength(
      1,
    );
  });

  it("enforces model and tool budgets after restoration", async () => {
    const repository = new MemoryRunCheckpointRepository();
    repository.trackRunningAttempt({
      runAttemptId: "attempt-1",
      owner: "worker-1",
      generation: 1,
    });

    const adapter = new DeclarativeRuntimeAdapter({
      modelGateway: {
        generateCompletion: vi.fn(async () => ({
          text: JSON.stringify({ answer: "x" }),
          toolCalls: [],
          finishReason: "stop" as const,
        })),
      },
      resolveToolMetadata: vi.fn(),
    });

    const request = checkpointEnabledRequest(
      {
        runtime: {
          type: "DECLARATIVE",
          config: {
            configVersion: "1",
            instructions: "Return JSON.",
            modelBinding: "primary",
            allowedToolBindings: [],
            maxModelInvocations: 2,
            maxToolInvocations: 0,
            checkpointingEnabled: true,
          },
        },
        toolVersionBindings: {},
        checkpoint: {
          port: { commit: (command) => repository.commit(command) },
          restore: {
            schemaVersion: DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION,
            messages: [
              { role: "system", content: "x" },
              { role: "user", content: "y" },
            ],
            modelInvocations: 2,
            toolInvocations: 0,
          },
        },
      },
      repository,
    );

    const result = await adapter.execute(request);
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("DECLARATIVE_BUDGET_EXCEEDED");
    }
  });

  it("does not commit checkpoints when checkpointing is disabled", async () => {
    const commits: CommitRunCheckpointCommand[] = [];
    const port: RunCheckpointPort = {
      commit: async (command): Promise<CommitRunCheckpointResult> => {
        commits.push(command);
        return {
          outcome: "committed",
          checkpoint: {
            id: "cp-1",
            workspaceId: command.workspaceId,
            runId: command.runId,
            sequence: 1,
            runAttemptId: command.runAttemptId,
            executionGeneration: 1,
            runtimeKind: "DECLARATIVE",
            envelopeVersion: "1",
            stateSchemaVersion: DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION,
            bindingIdentity: command.bindingIdentity,
            bindingDigest: "abc",
            cursor: command.cursor,
            state: command.state,
            payloadDigest: "def",
            createdAt: new Date().toISOString(),
          },
        };
      },
    };

    const adapter = new DeclarativeRuntimeAdapter({
      modelGateway: {
        generateCompletion: vi.fn(async () => ({
          text: JSON.stringify({ answer: "ok" }),
          toolCalls: [],
          finishReason: "stop" as const,
        })),
      },
      resolveToolMetadata: vi.fn(),
    });

    const request = checkpointEnabledRequest({
      runtime: {
        type: "DECLARATIVE",
        config: {
          configVersion: "1",
          instructions: "Return JSON.",
          modelBinding: "primary",
          allowedToolBindings: [],
          maxModelInvocations: 2,
          maxToolInvocations: 0,
          checkpointingEnabled: false,
        },
      },
      toolVersionBindings: {},
      checkpoint: { port },
    });

    await adapter.execute(request);
    expect(commits).toHaveLength(0);
  });
});
