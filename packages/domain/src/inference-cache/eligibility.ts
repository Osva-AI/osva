import {
  INFERENCE_CACHE_DEFAULT_MAX_ENTRY_BYTES,
  type InferenceCacheAuthorizedContext,
  type InferenceCacheEligibilityDecision,
  type InferenceCacheLookupInput,
  type InferenceCacheRequestMaterial,
  type InferenceCacheStoreInput,
  type InferenceResponseCachePolicyV1,
  type ExactResponseCacheLookupResult,
  type InferenceCacheBypassReason,
  type WorkspaceId,
} from "@osva-ai/contracts";

export function evaluateInferenceCacheLookupEligibility(
  input: InferenceCacheLookupInput,
): InferenceCacheEligibilityDecision {
  const workspaceCheck = assertCachePolicyWorkspace(
    input.workspaceId,
    input.policy,
  );
  if (!workspaceCheck.eligible) {
    return workspaceCheck;
  }
  return evaluateCommonEligibility(input, input, input.policy);
}

export function evaluateInferenceCacheStoreEligibility(
  input: InferenceCacheStoreInput,
): InferenceCacheEligibilityDecision {
  const workspaceCheck = assertCachePolicyWorkspace(
    input.workspaceId,
    input.policy,
  );
  if (!workspaceCheck.eligible) {
    return workspaceCheck;
  }
  const base = evaluateCommonEligibility(input, input, input.policy);
  if (!base.eligible) {
    return base;
  }

  if (input.terminalStatus !== "SUCCEEDED") {
    return { eligible: false, reason: "RESPONSE_FAILED" };
  }

  if (input.cancelled === true) {
    return { eligible: false, reason: "RESPONSE_CANCELLED" };
  }

  const response = input.response;
  const hasText =
    response.text !== undefined && response.text.trim().length > 0;
  const hasTools =
    response.toolCalls !== undefined && response.toolCalls.length > 0;

  if (!hasText && !hasTools) {
    return { eligible: false, reason: "RESPONSE_EMPTY" };
  }

  const maxBytes =
    input.policy.maxEntryBytes ?? INFERENCE_CACHE_DEFAULT_MAX_ENTRY_BYTES;
  const serialized = JSON.stringify({
    text: response.text ?? null,
    toolCalls: response.toolCalls ?? null,
    finishReason: response.finishReason ?? null,
  });
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    return { eligible: false, reason: "REQUEST_INVALID" };
  }

  return { eligible: true, reason: "ELIGIBLE" };
}

function evaluateCommonEligibility(
  authorized: InferenceCacheAuthorizedContext,
  material: InferenceCacheRequestMaterial,
  policy: InferenceResponseCachePolicyV1,
): InferenceCacheEligibilityDecision {
  if (!policy.enabled) {
    return { eligible: false, reason: "POLICY_DISABLED" };
  }

  if (policy.determinism !== "REQUIRED_DETERMINISTIC") {
    return { eligible: false, reason: "NON_DETERMINISTIC" };
  }

  if (
    authorized.workspaceId.trim().length === 0 ||
    material.modelProfileVersionId.trim().length === 0 ||
    material.configuredModelId.trim().length === 0
  ) {
    return { eligible: false, reason: "IDENTITY_INCOMPLETE" };
  }

  if (!Array.isArray(material.messages) || material.messages.length === 0) {
    return { eligible: false, reason: "REQUEST_INVALID" };
  }

  if (isEvaluationJudgePurpose(authorized.executionPurpose)) {
    if (policy.allowEvaluationJudgeCache !== true) {
      return { eligible: false, reason: "EVALUATION_JUDGE_FORBIDDEN" };
    }
  }

  const hasToolMessages = material.messages.some(
    (message: InferenceCacheRequestMaterial["messages"][number]) =>
      message.role === "tool",
  );
  if (hasToolMessages) {
    return { eligible: false, reason: "TOOL_LOOP_FORBIDDEN" };
  }

  const toolDefinitions = material.toolDefinitions;
  const hasToolDefinitions =
    toolDefinitions !== undefined && toolDefinitions.length > 0;

  if (hasToolDefinitions && policy.allowToolDefinitions !== true) {
    return { eligible: false, reason: "TOOL_DEFINITIONS_FORBIDDEN" };
  }

  return { eligible: true, reason: "ELIGIBLE" };
}

function isEvaluationJudgePurpose(
  purpose: InferenceCacheAuthorizedContext["executionPurpose"],
): boolean {
  return purpose === "EVALUATION_JUDGE" || purpose === "EVALUATION_PAIRWISE";
}

export function inferenceCacheFailureLookupResult(
  reason: InferenceCacheBypassReason = "INFRASTRUCTURE_UNAVAILABLE",
): ExactResponseCacheLookupResult {
  return { outcome: "bypass", reason };
}

/**
 * Optional hook when a persisted policy record is bound to a workspace id.
 * Fail-closed when the authorized workspace does not match policy scope.
 */
export function assertCachePolicyWorkspace(
  authorizedWorkspaceId: WorkspaceId,
  policy: InferenceResponseCachePolicyV1 & {
    readonly workspaceId?: WorkspaceId;
  },
): InferenceCacheEligibilityDecision {
  if (
    policy.workspaceId !== undefined &&
    policy.workspaceId !== authorizedWorkspaceId
  ) {
    return { eligible: false, reason: "POLICY_NOT_AUTHORIZED" };
  }
  return { eligible: true, reason: "ELIGIBLE" };
}
