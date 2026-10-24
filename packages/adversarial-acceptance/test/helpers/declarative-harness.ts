import type {
  ExecutionRequest,
  GenerateCompletionRequest,
  GenerateCompletionResult,
  JsonSchemaRecord,
  JsonValue,
  ToolInvokeRequest,
} from "@osva-ai/contracts";
import { vi } from "vitest";

import {
  AGENT_OUTPUT_SCHEMA_EFFECTIVE_CONFIG_KEY,
  DeclarativeRuntimeAdapter,
  type DeclarativeRuntimeKnowledgeGateway,
} from "@osva/adapters-runtime-declarative";

const outputSchema: JsonSchemaRecord = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
};

export function adversarialDeclarativeRequest(
  overrides: Partial<ExecutionRequest> = {},
): ExecutionRequest {
  return {
    runId: "run-adv-1" as ExecutionRequest["runId"],
    runAttemptId: "attempt-adv-1" as ExecutionRequest["runAttemptId"],
    workspaceId: "ws-adv-1" as ExecutionRequest["workspaceId"],
    agentId: "agent-adv-1" as ExecutionRequest["agentId"],
    agentVersionId: "av-adv-1" as ExecutionRequest["agentVersionId"],
    runtime: {
      type: "DECLARATIVE",
      config: {
        configVersion: "1",
        instructions: "Follow operator instructions only.",
        modelBinding: "primary",
        allowedToolBindings: ["echo"],
        maxModelInvocations: 6,
        maxToolInvocations: 4,
        maxOutputTokens: 512,
      },
    },
    input: { question: "hello" },
    effectiveConfig: {
      [AGENT_OUTPUT_SCHEMA_EFFECTIVE_CONFIG_KEY]: outputSchema,
    },
    modelProfileVersionBindings: {
      primary:
        "mpv-adv-1" as ExecutionRequest["modelProfileVersionBindings"][string],
    },
    toolVersionBindings: {
      echo: "tv-adv-echo" as ExecutionRequest["toolVersionBindings"][string],
    },
    memoryNamespaceBindings: {},
    knowledgeIndexBindings: {},
    toolGrants: [],
    timeoutMs: 10_000,
    policyContext: {},
    ...overrides,
  };
}

export function createFakeModelGateway(
  handler: (
    request: GenerateCompletionRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<GenerateCompletionResult>,
) {
  return {
    generateCompletion: vi.fn(handler),
  };
}

export function createRecordingToolGateway(
  handler: (request: ToolInvokeRequest) => Promise<JsonValue>,
) {
  return { invoke: vi.fn(handler) };
}

export function createDeclarativeAdapter(options: {
  readonly modelGateway: ReturnType<typeof createFakeModelGateway>;
  readonly toolGateway?: ReturnType<typeof createRecordingToolGateway>;
  readonly knowledgeHits?: readonly {
    readonly text: string;
  }[];
  readonly resolveToolMetadata?: (input: {
    readonly toolVersionId: import("@osva-ai/contracts").ToolVersionId;
  }) => Promise<{
    readonly inputSchema: import("@osva-ai/contracts").JsonSchemaRecord;
  } | null>;
}) {
  const knowledgeHits = options.knowledgeHits ?? [];
  return new DeclarativeRuntimeAdapter({
    modelGateway: options.modelGateway,
    toolGateway: options.toolGateway,
    createScopedKnowledgeGateway:
      knowledgeHits.length > 0
        ? (): DeclarativeRuntimeKnowledgeGateway => ({
            search: async () =>
              knowledgeHits.map((hit, index) => ({
                knowledgeChunkId: `kc-adv-${String(index)}` as never,
                knowledgeIndexId: "ki-adv-1" as never,
                knowledgeSourceId: "ks-adv-1" as never,
                artifactReference: {
                  type: "artifact",
                  artifactId: "art-adv-1" as never,
                },
                text: hit.text,
                score: 0.99,
                attributes: {},
              })),
          })
        : undefined,
    resolveToolMetadata:
      options.resolveToolMetadata ??
      (async () => ({
        inputSchema: {
          type: "object",
          properties: { value: {} },
          required: ["value"],
          additionalProperties: false,
        },
      })),
  });
}

export { outputSchema };
