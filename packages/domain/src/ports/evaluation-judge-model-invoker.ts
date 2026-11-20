import type { GenerateCompletionRequest } from "@osva-ai/contracts";

export interface EvaluationJudgeModelInvokeResult {
  readonly text?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteInputTokens?: number;
  readonly providerReportedModelId?: string;
  readonly configuredProviderModelId?: string;
  readonly providerResponseId?: string;
  readonly usageIncomplete?: boolean;
}

export interface EvaluationJudgeModelInvokeOptions {
  readonly signal?: AbortSignal;
  /** Worker-resolved model gateway budget binding when enforcement is active. */
  readonly budget?: unknown;
}

export interface EvaluationJudgeModelInvokeContextV1 {
  readonly workspaceId: import("@osva-ai/contracts").WorkspaceId;
  readonly evaluationJudgeTaskId: string;
  readonly sequence: number;
  readonly modelProfileVersionId: import("@osva-ai/contracts").ModelProfileVersionId;
  readonly userMessage: string;
  readonly maxOutputTokens?: number;
}

export interface EvaluationJudgeModelInvokeOptionsResolver {
  resolve(
    context: EvaluationJudgeModelInvokeContextV1,
  ): Promise<EvaluationJudgeModelInvokeOptions | undefined>;
}

export interface EvaluationJudgeModelInvoker {
  generateJudgeCompletion(
    request: GenerateCompletionRequest,
    options?: EvaluationJudgeModelInvokeOptions,
  ): Promise<EvaluationJudgeModelInvokeResult>;
}
