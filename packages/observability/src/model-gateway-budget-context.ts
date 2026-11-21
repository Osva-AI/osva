import type {
  ExecutionRequest,
  InferenceBudgetInvocationOrdinalPort,
  InferenceBudgetPeriodKeyV1,
  InferenceBudgetRuntimePolicyV1,
  InferenceInvocationKind,
  ModelProfileVersionId,
  RunStepId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION } from "@osva-ai/contracts";
import { inferenceBudgetRuntimePolicySchema } from "@osva-ai/contracts/schemas";
import type { InferenceBudgetAdmissionPort } from "@osva-ai/contracts";
import {
  mergeTrustedInferenceBudgetRuntimePolicy,
  resolveInferenceBudgetUtcPeriodIdentity,
} from "@osva/domain";
import type {
  ModelGatewayBudgetContext,
  ModelGatewayGenerateTextOptions,
  TrustedModelGatewayBudgetBindingV1,
} from "@osva/model-gateway";

const INFERENCE_BUDGET_POLICY_CONTEXT_KEY = "inferenceBudget" as const;
const INFERENCE_BUDGET_LOGICAL_OPERATION_KEY =
  "inferenceBudgetLogicalOperationKey" as const;

export interface InferenceBudgetOrdinalAllocator {
  next(runAttemptId: string, bindingName: string): number;
}

export function createInferenceBudgetOrdinalAllocator(): InferenceBudgetOrdinalAllocator {
  const counters = new Map<string, number>();
  return {
    next(runAttemptId, bindingName) {
      const key = `${runAttemptId}:${bindingName}`;
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
  };
}

function readInferenceBudgetPolicy(
  execution: ExecutionRequest,
): InferenceBudgetRuntimePolicyV1 | undefined {
  const raw = execution.policyContext[INFERENCE_BUDGET_POLICY_CONTEXT_KEY];
  if (raw === undefined || raw === null || typeof raw !== "object") {
    return undefined;
  }
  const parsed = inferenceBudgetRuntimePolicySchema.safeParse(raw);
  return parsed.success
    ? (parsed.data as InferenceBudgetRuntimePolicyV1)
    : undefined;
}

function resolveLogicalOperationKey(
  execution: ExecutionRequest,
  bindingName: string,
  explicit?: string,
): string {
  if (explicit !== undefined && explicit.trim().length > 0) {
    return explicit;
  }
  const fromPolicy =
    execution.policyContext[INFERENCE_BUDGET_LOGICAL_OPERATION_KEY];
  if (typeof fromPolicy === "string" && fromPolicy.trim().length > 0) {
    return fromPolicy;
  }
  const restore = execution.checkpoint?.restore;
  if (restore !== undefined) {
    return `${execution.runAttemptId}:${bindingName}:ckpt:${restore.modelInvocations + 1}`;
  }
  return `${execution.runAttemptId}:${bindingName}:native`;
}

export type TrustedWorkspaceInferenceBudgetPolicyResolver = (
  workspaceId: WorkspaceId,
) => Promise<InferenceBudgetRuntimePolicyV1 | null>;

export async function resolveModelGatewayBudgetContextAsync(input: {
  readonly execution: ExecutionRequest;
  readonly admission: InferenceBudgetAdmissionPort | undefined;
  readonly bindingName: string;
  readonly modelProfileVersionId: ModelProfileVersionId;
  readonly runStepId?: RunStepId;
  readonly invocationKind: InferenceInvocationKind;
  readonly ordinalPort?: InferenceBudgetInvocationOrdinalPort;
  readonly ordinals?: InferenceBudgetOrdinalAllocator;
  readonly logicalOperationKey?: string;
  readonly resolveTrustedWorkspacePolicy?: TrustedWorkspaceInferenceBudgetPolicyResolver;
}): Promise<ModelGatewayBudgetContext | undefined> {
  const merged = mergeTrustedInferenceBudgetRuntimePolicy(
    input.resolveTrustedWorkspacePolicy !== undefined
      ? await input.resolveTrustedWorkspacePolicy(input.execution.workspaceId)
      : readInferenceBudgetPolicy(input.execution),
  );
  if (merged.enabled !== true || merged.policyVersionId === undefined) {
    return { enforcement: "DISABLED" };
  }

  if (input.admission === undefined) {
    return { enforcement: "FAIL_CLOSED" };
  }

  const executionGeneration =
    input.execution.executionOwnership?.generation ?? 0;

  let modelInvocationOrdinal = 1;
  if (input.ordinalPort !== undefined) {
    const logicalOperationKey = resolveLogicalOperationKey(
      input.execution,
      input.bindingName,
      input.logicalOperationKey,
    );
    const allocated = await input.ordinalPort.allocateOrGetOrdinal({
      workspaceId: input.execution.workspaceId,
      runAttemptId: input.execution.runAttemptId,
      bindingName: input.bindingName,
      logicalOperationKey,
    });
    modelInvocationOrdinal = allocated.modelInvocationOrdinal;
  } else if (input.ordinals !== undefined) {
    modelInvocationOrdinal = input.ordinals.next(
      input.execution.runAttemptId,
      input.bindingName,
    );
  }

  const now = new Date();
  const period = resolveInferenceBudgetUtcPeriodIdentity(now);

  const binding: TrustedModelGatewayBudgetBindingV1 = {
    enforcement: "ENABLED",
    workspaceId: input.execution.workspaceId,
    admission: input.admission,
    runtimePolicy: merged,
    anchor: {
      anchorFormatVersion: INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
      workspaceId: input.execution.workspaceId,
      invocationKind: input.invocationKind,
      material: {
        scope: "AGENT_RUN",
        runAttemptId: input.execution.runAttemptId,
        executionGeneration,
        bindingName: input.bindingName,
        modelInvocationOrdinal,
      },
    },
    periodKey: period.periodKey as InferenceBudgetPeriodKeyV1,
    pricingSnapshotId: `mpv:${input.modelProfileVersionId}`,
    runId: input.execution.runId,
    runAttemptId: input.execution.runAttemptId,
    runStepId: input.runStepId,
    invocationKind: input.invocationKind,
    executionGenerationFence: executionGeneration,
    executionOwner: input.execution.executionOwnership?.owner,
  };

  return binding;
}

export function mergeModelGatewayBudgetOptions(
  base: ModelGatewayGenerateTextOptions | undefined,
  budget: ModelGatewayBudgetContext | undefined,
): ModelGatewayGenerateTextOptions | undefined {
  if (base === undefined && budget === undefined) {
    return undefined;
  }
  return {
    ...base,
    budget,
  };
}
