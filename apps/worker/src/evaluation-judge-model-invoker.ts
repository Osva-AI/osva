import type { GenerateCompletionRequest } from "@osva-ai/contracts";
import type {
  EvaluationJudgeModelInvoker,
  EvaluationJudgeModelInvokeOptions,
} from "@osva/domain";
import type { ModelGateway } from "@osva/model-gateway";

export function createEvaluationJudgeModelInvoker(
  modelGateway: ModelGateway,
): EvaluationJudgeModelInvoker {
  return {
    async generateJudgeCompletion(
      request: GenerateCompletionRequest,
      options?: EvaluationJudgeModelInvokeOptions,
    ) {
      const outcome = await modelGateway.generateCompletionOutcome(request, {
        signal: options?.signal,
      });
      const usage = outcome.usage;
      return {
        text: outcome.text,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        cachedInputTokens: usage?.cachedInputTokens,
        cacheWriteInputTokens: usage?.cacheWriteInputTokens,
        configuredProviderModelId:
          outcome.invocation?.configuredProviderModelId,
        providerReportedModelId:
          outcome.invocation?.providerReportedModelId ??
          outcome.invocation?.configuredProviderModelId,
        providerResponseId: outcome.providerRequestId,
        usageIncomplete: usage?.incomplete === true,
      };
    },
  };
}
