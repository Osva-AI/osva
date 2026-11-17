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
}

export interface EvaluationJudgeModelInvoker {
  generateJudgeCompletion(
    request: GenerateCompletionRequest,
    options?: EvaluationJudgeModelInvokeOptions,
  ): Promise<EvaluationJudgeModelInvokeResult>;
}
