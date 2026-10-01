import type { GenerateTextInput, GenerateTextResult } from "@osva-ai/contracts";
import type { Readable } from "node:stream";

export interface TrustedKnowledgeHit {
  readonly knowledgeChunkId: string;
  readonly knowledgeIndexId: string;
  readonly knowledgeSourceId: string;
  readonly text: string;
  readonly score: number;
  readonly location?: {
    readonly heading?: string;
  };
}

export interface TrustedArtifactView {
  readonly id: string;
  readonly name: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly digest: string;
  readonly metadata: Record<string, unknown>;
  readonly reference: {
    readonly type: "artifact";
    readonly artifactId: string;
  };
}

export interface TrustedAgentModels {
  generateText(
    binding: string,
    request: GenerateTextInput,
  ): Promise<GenerateTextResult>;
}

export interface TrustedAgentTools {
  invoke(
    binding: string,
    input: unknown,
    options?: { readonly idempotencyKey?: string },
  ): Promise<unknown>;
}

export interface TrustedAgentKnowledge {
  search(
    binding: string,
    query: string,
    options?: { readonly topK?: number },
  ): Promise<readonly TrustedKnowledgeHit[]>;
}

export interface TrustedAgentArtifacts {
  create(
    name: string,
    content: Readable,
    options?: {
      readonly mediaType?: string;
      readonly metadata?: Record<string, unknown>;
      readonly idempotencyKey?: string;
    },
  ): Promise<TrustedArtifactView>;
}

export interface TrustedAgentBaseContext {
  readonly input: unknown;
}

export interface ResearchAgentContext extends TrustedAgentBaseContext {
  readonly models: TrustedAgentModels;
  readonly tools: TrustedAgentTools;
  readonly knowledge: TrustedAgentKnowledge;
}

export interface AnalysisAgentContext extends TrustedAgentBaseContext {
  readonly models: TrustedAgentModels;
  readonly knowledge: TrustedAgentKnowledge;
}

export interface ReportAgentContext extends TrustedAgentBaseContext {
  readonly models: TrustedAgentModels;
  readonly artifacts: TrustedAgentArtifacts;
  readonly executionId?: string;
}
