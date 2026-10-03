import type { GenerateTextInput, GenerateTextResult } from "@osva-ai/contracts";
import { vi } from "vitest";

import type {
  AnalysisAgentContext,
  ReportAgentContext,
  ResearchAgentContext,
  TrustedArtifactView,
  TrustedKnowledgeHit,
} from "../agents/src/shared/context.js";

export function createKnowledgeMock(hits: readonly TrustedKnowledgeHit[] = []) {
  return vi.fn(
    async (_binding: string, _query: string, _options?: { topK?: number }) =>
      hits,
  );
}

export function createToolsMock(handlers: Record<string, unknown>) {
  return vi.fn(async (binding: string, input: unknown, options?: unknown) => {
    if (!(binding in handlers)) {
      throw new Error(`Unexpected tool binding: ${binding}`);
    }
    const handler = handlers[binding];
    if (typeof handler === "function") {
      return handler(input, options);
    }
    return handler;
  });
}

export function createModelsMock(
  responder: (
    binding: string,
    request: GenerateTextInput,
  ) => GenerateTextResult | Promise<GenerateTextResult>,
) {
  return vi.fn(async (binding: string, request: GenerateTextInput) =>
    responder(binding, request),
  );
}

type ArtifactCreateOptions = {
  readonly mediaType?: string;
  readonly metadata?: Record<string, unknown>;
  readonly idempotencyKey?: string;
};

export function createArtifactsMock(
  impl?: (
    name: string,
    content: unknown,
    options?: ArtifactCreateOptions,
  ) => Promise<TrustedArtifactView>,
) {
  const defaultImpl = async (
    name: string,
    _content: unknown,
    options?: {
      mediaType?: string;
      metadata?: Record<string, unknown>;
      idempotencyKey?: string;
    },
  ): Promise<TrustedArtifactView> => ({
    id: "artifact-created-1",
    name,
    mediaType: options?.mediaType ?? "text/plain",
    sizeBytes: 128,
    digest: "sha256:" + "a".repeat(64),
    metadata: options?.metadata ?? {},
    reference: { type: "artifact", artifactId: "artifact-created-1" },
  });

  return vi.fn(impl ?? defaultImpl);
}

export function createResearchContext(options: {
  readonly input: unknown;
  readonly knowledgeSearch?: ReturnType<typeof createKnowledgeMock>;
  readonly toolsInvoke?: ReturnType<typeof createToolsMock>;
  readonly generateText?: ReturnType<typeof createModelsMock>;
}): ResearchAgentContext {
  return {
    input: options.input,
    knowledge: { search: options.knowledgeSearch ?? createKnowledgeMock() },
    tools: {
      invoke:
        options.toolsInvoke ??
        vi.fn(async () => {
          throw new Error("Unexpected tool invocation in Research test.");
        }),
    },
    models: {
      generateText:
        options.generateText ??
        createModelsMock(() => ({ text: '{"findings":[],"warnings":[]}' })),
    },
  };
}

export function createAnalysisContext(options: {
  readonly input: unknown;
  readonly knowledgeSearch?: ReturnType<typeof createKnowledgeMock>;
  readonly toolsInvoke?: ReturnType<typeof createToolsMock>;
  readonly generateText?: ReturnType<typeof createModelsMock>;
}): AnalysisAgentContext {
  return {
    input: options.input,
    knowledge: { search: options.knowledgeSearch ?? createKnowledgeMock() },
    models: {
      generateText:
        options.generateText ??
        createModelsMock(() => ({
          text: JSON.stringify({
            disposition: "NEEDS_REVIEW",
            confidence: "LOW",
            summary: "Insufficient evidence.",
            criteria: [],
            risks: [],
            openQuestions: [],
          }),
        })),
    },
  };
}

export function createReportContext(options: {
  readonly input: unknown;
  readonly generateText?: ReturnType<typeof createModelsMock>;
  readonly artifactsCreate?: ReturnType<typeof createArtifactsMock>;
  readonly executionId?: string;
}): ReportAgentContext {
  return {
    input: options.input,
    executionId: options.executionId ?? "execution-attempt-1",
    models: {
      generateText:
        options.generateText ??
        createModelsMock(() => ({
          text: "# Dependency Adoption Review\n\nBody",
        })),
    },
    artifacts: {
      create: options.artifactsCreate ?? createArtifactsMock(),
    },
  };
}
