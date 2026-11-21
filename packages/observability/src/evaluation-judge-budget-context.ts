import type {
  EvaluationJudgeTaskId,
  InferenceBudgetAdmissionPort,
  InferenceBudgetPeriodKeyV1,
  InferenceBudgetRuntimePolicyV1,
  ModelProfileVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION } from "@osva-ai/contracts";
import { inferenceBudgetRuntimePolicySchema } from "@osva-ai/contracts/schemas";
import {
  mergeTrustedInferenceBudgetRuntimePolicy,
  resolveInferenceBudgetUtcPeriodIdentity,
} from "@osva/domain";
import type { ModelProfileVersion } from "@osva/domain";
import type { TrustedModelGatewayBudgetBindingV1 } from "@osva/model-gateway";

export async function resolveEvaluationJudgeBudgetContext(input: {
  readonly workspaceId: WorkspaceId;
  readonly admission: InferenceBudgetAdmissionPort;
  readonly runtimePolicy: InferenceBudgetRuntimePolicyV1 | null | undefined;
  readonly evaluationJudgeTaskId: EvaluationJudgeTaskId | string;
  readonly sequence: number;
  readonly modelProfileVersionId: ModelProfileVersionId;
  readonly modelProfileVersion: ModelProfileVersion | null;
}): Promise<TrustedModelGatewayBudgetBindingV1 | { enforcement: "DISABLED" }> {
  const merged = mergeTrustedInferenceBudgetRuntimePolicy(
    input.runtimePolicy ?? undefined,
  );
  if (merged.enabled !== true || merged.policyVersionId === undefined) {
    return { enforcement: "DISABLED" };
  }

  if (input.modelProfileVersion === null) {
    throw new Error(
      "Inference budget enforcement requires a model profile version.",
    );
  }

  const now = new Date();
  const period = resolveInferenceBudgetUtcPeriodIdentity(now);

  const binding: TrustedModelGatewayBudgetBindingV1 = {
    enforcement: "ENABLED",
    workspaceId: input.workspaceId,
    admission: input.admission,
    runtimePolicy: merged,
    anchor: {
      anchorFormatVersion: INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
      workspaceId: input.workspaceId,
      invocationKind: "JUDGE",
      material: {
        scope: "EVALUATION_JUDGE",
        evaluationJudgeTaskId:
          input.evaluationJudgeTaskId as EvaluationJudgeTaskId,
        sequence: input.sequence,
      },
    },
    periodKey: period.periodKey as InferenceBudgetPeriodKeyV1,
    pricingSnapshotId: `mpv:${input.modelProfileVersionId}`,
    invocationKind: "JUDGE",
    selectedModelProfileVersionId: input.modelProfileVersionId,
    providerAttemptIndex: 0,
  };

  return binding;
}

export function parseTrustedInferenceBudgetRuntimePolicy(
  raw: unknown,
): InferenceBudgetRuntimePolicyV1 | undefined {
  if (raw === undefined || raw === null || typeof raw !== "object") {
    return undefined;
  }
  const parsed = inferenceBudgetRuntimePolicySchema.safeParse(raw);
  return parsed.success
    ? (parsed.data as InferenceBudgetRuntimePolicyV1)
    : undefined;
}
