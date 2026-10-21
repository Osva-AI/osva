import type {
  ExecutionRequest,
  GenerateCompletionRequest,
  GenerateCompletionResult,
  JsonSchemaRecord,
  JsonValue,
  ToolInvokeRequest,
} from "@osva-ai/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  AGENT_OUTPUT_SCHEMA_EFFECTIVE_CONFIG_KEY,
  DeclarativeRuntimeAdapter,
  type DeclarativeRuntimeKnowledgeGateway,
} from "../src/index.js";

const outputSchema: JsonSchemaRecord = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
};

function baseRequest(
  overrides: Partial<ExecutionRequest> = {},
): ExecutionRequest {
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
        maxToolInvocations: 2,
        maxOutputTokens: 256,
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
    ...overrides,
  };
}

function createModelGateway(
  handler: (
    request: GenerateCompletionRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<GenerateCompletionResult>,
) {
  return {
    generateCompletion: vi.fn(handler),
  };
}

function createToolGateway(
  handler: (request: ToolInvokeRequest) => Promise<JsonValue>,
) {
  return { invoke: vi.fn(handler) };
}

describe("DeclarativeRuntimeAdapter", () => {
  it("succeeds for model-only agents with valid structured output", async () => {
    const adapter = new DeclarativeRuntimeAdapter({
      modelGateway: createModelGateway(async () => ({
        text: JSON.stringify({ answer: "ok" }),
        toolCalls: [],
        finishReason: "stop",
      })),
      resolveToolMetadata: vi.fn(),
    });

    const request = baseRequest({
      runtime: {
        type: "DECLARATIVE",
        config: {
          configVersion: "1",
          instructions: "Return JSON.",
          modelBinding: "primary",
          allowedToolBindings: [],
          maxModelInvocations: 2,
          maxToolInvocations: 0,
        },
      },
      toolVersionBindings: {},
    });

    await expect(adapter.execute(request)).resolves.toEqual({
      status: "succeeded",
      output: { answer: "ok" },
    });
  });

  it("executes model → tool → model flow", async () => {
    let modelCalls = 0;
    const adapter = new DeclarativeRuntimeAdapter({
      modelGateway: createModelGateway(async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            toolCalls: [
              {
                id: "call-1",
                name: "echo",
                arguments: { value: "payload" },
              },
            ],
            finishReason: "tool_call",
          };
        }

        return {
          text: JSON.stringify({ answer: "done" }),
          toolCalls: [],
          finishReason: "stop",
        };
      }),
      toolGateway: createToolGateway(async () => ({ value: "payload" })),
      resolveToolMetadata: vi.fn(async () => ({
        inputSchema: {
          type: "object",
          properties: { value: {} },
          required: ["value"],
          additionalProperties: false,
        },
      })),
    });

    const result = await adapter.execute(baseRequest());
    expect(result).toEqual({ status: "succeeded", output: { answer: "done" } });
    expect(modelCalls).toBe(2);
  });

  it("rejects unauthorized tool calls", async () => {
    const adapter = new DeclarativeRuntimeAdapter({
      modelGateway: {
        generateCompletion: async () => ({
          toolCalls: [{ id: "1", name: "secret", arguments: { value: true } }],
          finishReason: "tool_call" as const,
        }),
      },
      toolGateway: createToolGateway(async () => ({ ok: true })),
      resolveToolMetadata: async () => null,
    });

    const result = await adapter.execute(baseRequest());
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("TOOL_NOT_AUTHORIZED");
    }
  });

  it("rejects missing model binding", async () => {
    const adapter = new DeclarativeRuntimeAdapter({
      modelGateway: createModelGateway(async () => ({
        text: JSON.stringify({ answer: "x" }),
        toolCalls: [],
        finishReason: "stop",
      })),
      resolveToolMetadata: vi.fn(),
    });

    const result = await adapter.execute(
      baseRequest({ modelProfileVersionBindings: {} }),
    );
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("BINDING_MISMATCH");
    }
  });

  it("rejects tool input schema violations", async () => {
    const adapter = new DeclarativeRuntimeAdapter({
      modelGateway: createModelGateway(async () => ({
        toolCalls: [{ id: "1", name: "echo", arguments: { wrong: true } }],
        finishReason: "tool_call",
      })),
      toolGateway: createToolGateway(async () => ({ value: true })),
      resolveToolMetadata: vi.fn(async () => ({
        inputSchema: {
          type: "object",
          properties: { value: {} },
          required: ["value"],
          additionalProperties: false,
        },
      })),
    });

    const result = await adapter.execute(baseRequest());
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("INVALID_TOOL_INPUT");
    }
  });

  it("enforces model invocation budget", async () => {
    const adapter = new DeclarativeRuntimeAdapter({
      modelGateway: createModelGateway(async () => ({
        toolCalls: [{ id: "1", name: "echo", arguments: { value: 1 } }],
        finishReason: "tool_call",
      })),
      toolGateway: createToolGateway(async () => ({ value: 1 })),
      resolveToolMetadata: vi.fn(async () => ({
        inputSchema: {
          type: "object",
          properties: { value: {} },
          required: ["value"],
          additionalProperties: false,
        },
      })),
    });

    const template = baseRequest();
    const declarativeRuntime = template.runtime;
    if (declarativeRuntime.type !== "DECLARATIVE") {
      throw new Error("expected declarative runtime fixture");
    }

    const result = await adapter.execute({
      ...template,
      runtime: {
        type: "DECLARATIVE",
        config: {
          ...declarativeRuntime.config,
          maxModelInvocations: 1,
          maxToolInvocations: 4,
        },
      },
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("DECLARATIVE_BUDGET_EXCEEDED");
    }
  });

  it("rejects invalid structured output", async () => {
    const adapter = new DeclarativeRuntimeAdapter({
      modelGateway: {
        generateCompletion: async () => ({
          text: JSON.stringify({ wrong: true }),
          toolCalls: [],
          finishReason: "stop" as const,
        }),
      },
      resolveToolMetadata: async () => null,
    });

    const result = await adapter.execute(baseRequest());
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("INVALID_RUNTIME_OUTPUT");
    }
  });

  it("prefetches bound knowledge into the user message before the first model call", async () => {
    let firstUserContent: string | undefined;
    const adapter = new DeclarativeRuntimeAdapter({
      modelGateway: createModelGateway(async (request) => {
        const userMessage = request.messages.find(
          (message) => message.role === "user",
        );
        if (
          userMessage !== undefined &&
          typeof userMessage.content === "string"
        ) {
          firstUserContent = userMessage.content;
        }
        return {
          text: JSON.stringify({ answer: "ok" }),
          toolCalls: [],
          finishReason: "stop",
        };
      }),
      createScopedKnowledgeGateway: (): DeclarativeRuntimeKnowledgeGateway => ({
        search: async (_execution, _bindingName, _request) => [
          {
            knowledgeChunkId: "kc-1" as never,
            knowledgeIndexId: "ki-1" as never,
            knowledgeSourceId: "ks-1" as never,
            artifactReference: {
              type: "artifact",
              artifactId: "art-1" as never,
            },
            text: "Policy excerpt about refunds.",
            score: 0.91,
            attributes: {},
          },
        ],
      }),
      resolveToolMetadata: vi.fn(),
    });

    const result = await adapter.execute(
      baseRequest({
        knowledgeIndexBindings: {
          policy_docs: ["ki-1" as never],
        },
        input: { task: "Summarize refund policy" },
        runtime: {
          type: "DECLARATIVE",
          config: {
            configVersion: "1",
            instructions: "Use evidence only.",
            modelBinding: "primary",
            allowedToolBindings: [],
            maxModelInvocations: 2,
            maxToolInvocations: 0,
          },
        },
        toolVersionBindings: {},
      }),
    );

    expect(result.status).toBe("succeeded");
    expect(firstUserContent).toContain("untrusted retrieved data");
    expect(firstUserContent).toContain("Policy excerpt about refunds.");
    expect(firstUserContent).toContain("Summarize refund policy");
  });

  it("does not retrieve knowledge when no bindings are present", async () => {
    const search: DeclarativeRuntimeKnowledgeGateway["search"] = vi.fn(
      async () => [],
    );
    const adapter = new DeclarativeRuntimeAdapter({
      modelGateway: createModelGateway(async () => ({
        text: JSON.stringify({ answer: "ok" }),
        toolCalls: [],
        finishReason: "stop",
      })),
      createScopedKnowledgeGateway: () => ({ search }),
      resolveToolMetadata: vi.fn(),
    });

    await adapter.execute(
      baseRequest({
        knowledgeIndexBindings: {},
        runtime: {
          type: "DECLARATIVE",
          config: {
            configVersion: "1",
            instructions: "Test",
            modelBinding: "primary",
            allowedToolBindings: [],
            maxModelInvocations: 2,
            maxToolInvocations: 0,
          },
        },
        toolVersionBindings: {},
      }),
    );

    expect(search).not.toHaveBeenCalled();
  });

  it("supports cooperative cancellation", async () => {
    const adapter = new DeclarativeRuntimeAdapter({
      modelGateway: createModelGateway(
        (_request, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => {
              reject(new Error("cancelled"));
            });
          }),
      ),
      resolveToolMetadata: vi.fn(),
    });

    const request = baseRequest();
    const pending = adapter.execute(request);
    await adapter.cancel(request.runAttemptId);
    await expect(pending).resolves.toMatchObject({
      status: "failed",
      error: { code: "RUNTIME_CANCELLED" },
    });
  });
});
