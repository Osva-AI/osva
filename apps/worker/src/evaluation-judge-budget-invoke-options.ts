import type { ModelProfileRepository } from "@osva/domain";
import type {
  EvaluationJudgeModelInvokeContextV1,
  EvaluationJudgeModelInvokeOptions,
  EvaluationJudgeModelInvokeOptionsResolver,
} from "@osva/domain";
import type { InferenceBudgetAdmissionPort } from "@osva-ai/contracts";
import type { PostgresInferenceBudgetPolicyRepository } from "@osva/db";
import { resolveEvaluationJudgeBudgetContext } from "@osva/observability";

export function createEvaluationJudgeInvokeOptionsResolver(input: {
  readonly policies: PostgresInferenceBudgetPolicyRepository;
  readonly admission: InferenceBudgetAdmissionPort;
  readonly modelProfiles: ModelProfileRepository;
}): EvaluationJudgeModelInvokeOptionsResolver {
  return {
    async resolve(
      context: EvaluationJudgeModelInvokeContextV1,
    ): Promise<EvaluationJudgeModelInvokeOptions | undefined> {
      const runtime = await input.policies.findRuntimePolicyByWorkspaceId(
        context.workspaceId,
      );
      const modelProfileVersion =
        await input.modelProfiles.findModelProfileVersionById(
          context.modelProfileVersionId,
        );
      const budget = await resolveEvaluationJudgeBudgetContext({
        workspaceId: context.workspaceId,
        admission: input.admission,
        runtimePolicy: runtime,
        evaluationJudgeTaskId: context.evaluationJudgeTaskId,
        sequence: context.sequence,
        modelProfileVersionId: context.modelProfileVersionId,
        modelProfileVersion,
      });
      if (budget.enforcement === "DISABLED") {
        return undefined;
      }
      return { budget };
    },
  };
}
