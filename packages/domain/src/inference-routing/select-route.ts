import type {
  InferenceRoutingCostEstimate,
  InferenceRoutingLatencyObservation,
  InferenceRoutingPolicyDefinitionV1,
  InferenceRoutingSelectionReason,
  InferenceRoutingStrategy,
  ModelProfileVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  estimateRoutingInputTokens,
  estimateRoutingPreflightCostUsdMicros,
} from "@osva-ai/contracts";
import type { ModelConversationMessage } from "@osva-ai/contracts";

import type { ModelProfileVersion } from "../model-profile-version.js";
import { assignBalancedRanks, balancedSortKey } from "./balanced-rank.js";
import { satisfiesRoutingCapabilities } from "./capability.js";
import type { InferenceRoutingCircuitBreakerRegistry } from "./circuit-breaker.js";
import type { InferenceRoutingLatencyStore } from "./latency-store.js";

export interface RoutingCandidateContext {
  readonly version: ModelProfileVersion;
  readonly workspaceAuthorized: boolean;
  readonly connectionResolvable: boolean;
  readonly cost: InferenceRoutingCostEstimate;
  readonly latency: InferenceRoutingLatencyObservation;
  readonly circuitEligible: boolean;
}

export interface SelectInferenceRouteInput {
  readonly workspaceId: WorkspaceId;
  readonly policy: InferenceRoutingPolicyDefinitionV1;
  readonly messages: readonly ModelConversationMessage[];
  readonly maxOutputTokens: number | undefined;
  readonly hasToolDefinitions: boolean;
  readonly hasJsonSchema: boolean;
  readonly requiresStreaming: boolean;
  readonly boundModelProfileVersionId?: ModelProfileVersionId;
  readonly resolveVersion: (
    id: ModelProfileVersionId,
  ) => Promise<ModelProfileVersion | null>;
  readonly authorizeWorkspace: (
    version: ModelProfileVersion,
  ) => Promise<boolean>;
  readonly connectionResolvable: (
    version: ModelProfileVersion,
  ) => Promise<boolean>;
  readonly circuitBreaker?: InferenceRoutingCircuitBreakerRegistry;
  readonly latencyStore?: InferenceRoutingLatencyStore;
  readonly atMs: number;
}

export interface SelectInferenceRouteResult {
  readonly orderedCandidateIds: readonly ModelProfileVersionId[];
  readonly primary: {
    readonly modelProfileVersionId: ModelProfileVersionId;
    readonly reason: InferenceRoutingSelectionReason;
    readonly estimatedCost: InferenceRoutingCostEstimate;
  };
  readonly eligibleCount: number;
}

export async function selectInferenceRoute(
  input: SelectInferenceRouteInput,
): Promise<SelectInferenceRouteResult> {
  const candidateIds = buildCandidateOrder(input.policy);
  const contexts: RoutingCandidateContext[] = [];

  for (const id of candidateIds) {
    const version = await input.resolveVersion(id);
    if (version === null) {
      continue;
    }

    if (
      input.policy.allowedProviders !== undefined &&
      !input.policy.allowedProviders.includes(version.provider)
    ) {
      continue;
    }

    if (
      !satisfiesRoutingCapabilities({
        provider: version.provider,
        requirements: input.policy.capabilityRequirements,
        hasToolDefinitions: input.hasToolDefinitions,
        hasJsonSchema: input.hasJsonSchema,
        requiresStreaming: input.requiresStreaming,
        requestedMaxOutputTokens: input.maxOutputTokens,
      })
    ) {
      continue;
    }

    const workspaceAuthorized = await input.authorizeWorkspace(version);
    if (!workspaceAuthorized) {
      continue;
    }

    const connectionOk = await input.connectionResolvable(version);
    if (!connectionOk) {
      continue;
    }

    const inputTokens = estimateRoutingInputTokens(input.messages);
    const cost = estimateRoutingPreflightCostUsdMicros({
      estimatedInputTokens: inputTokens,
      maxOutputTokens: input.maxOutputTokens,
      pricing: version.pricing,
    });

    if (
      input.policy.maxEstimatedCostUsdMicros !== undefined &&
      cost.estimatedCostUsdMicros !== null &&
      cost.estimatedCostUsdMicros > input.policy.maxEstimatedCostUsdMicros
    ) {
      continue;
    }

    if (
      input.policy.maxEstimatedCostUsdMicros !== undefined &&
      cost.estimatedCostUsdMicros === null &&
      input.policy.unknownCostBehavior === "EXCLUDE_FROM_RANKING"
    ) {
      continue;
    }

    const circuitEligible =
      input.circuitBreaker === undefined
        ? true
        : input.circuitBreaker.isEligible({
            workspaceId: input.workspaceId,
            modelProfileVersionId: version.id,
            connectionVersionId: version.modelProviderConnectionVersionId,
            atMs: input.atMs,
          });
    if (!circuitEligible) {
      continue;
    }

    const latency = input.latencyStore?.observe(
      input.workspaceId,
      version.id,
    ) ?? {
      sampleCount: 0,
      medianCompletionMs: null,
      sufficientEvidence: false,
    };

    contexts.push({
      version,
      workspaceAuthorized,
      connectionResolvable: connectionOk,
      cost,
      latency,
      circuitEligible,
    });
  }

  if (contexts.length === 0) {
    throw new InferenceRoutingSelectionError("NO_ELIGIBLE_CANDIDATE");
  }

  const ranked = rankCandidates(
    contexts,
    input.policy.strategy,
    input.policy,
    candidateIds,
  );
  const primary = ranked[0]!;

  return {
    orderedCandidateIds: ranked.map((row) => row.version.id),
    primary: {
      modelProfileVersionId: primary.version.id,
      reason: primary.reason,
      estimatedCost: primary.cost,
    },
    eligibleCount: contexts.length,
  };
}

export class InferenceRoutingSelectionError extends Error {
  constructor(readonly reason: "NO_ELIGIBLE_CANDIDATE" | "BUDGET_EXCEEDED") {
    super(reason);
    this.name = "InferenceRoutingSelectionError";
  }
}

interface RankedCandidate extends RoutingCandidateContext {
  readonly reason: InferenceRoutingSelectionReason;
  readonly sortKey: number;
}

function buildCandidateOrder(
  policy: InferenceRoutingPolicyDefinitionV1,
): ModelProfileVersionId[] {
  const ordered = [...policy.candidateModelProfileVersionIds];
  if (policy.fallbackModelProfileVersionIds !== undefined) {
    for (const id of policy.fallbackModelProfileVersionIds) {
      if (!ordered.includes(id)) {
        ordered.push(id);
      }
    }
  }
  return ordered;
}

function rankCandidates(
  contexts: RoutingCandidateContext[],
  strategy: InferenceRoutingStrategy,
  policy: InferenceRoutingPolicyDefinitionV1,
  policyOrder: readonly ModelProfileVersionId[],
): RankedCandidate[] {
  const policyRank = new Map(
    policyOrder.map((id, index) => [id, index] as const),
  );

  const balancedRanks =
    strategy === "BALANCED"
      ? assignBalancedRanks(
          contexts.map((ctx) => ({
            policyIndex: policyRank.get(ctx.version.id) ?? 9_999,
            cost: ctx.cost,
            latency: ctx.latency,
          })),
        )
      : undefined;

  const ranked: RankedCandidate[] = contexts.map((ctx, contextIndex) => {
    const policyIndex = policyRank.get(ctx.version.id) ?? 9_999;
    let sortKey = policyIndex;
    let reason: InferenceRoutingSelectionReason = "POLICY_PRIORITY";

    if (strategy === "FIXED") {
      const preferred =
        policy.preferredModelProfileVersionId ??
        policy.candidateModelProfileVersionIds[0];
      if (ctx.version.id === preferred) {
        reason = "FIXED_PREFERRED";
        sortKey = -1;
      } else {
        sortKey = policyIndex;
        reason = "POLICY_PRIORITY";
      }
    } else if (strategy === "LOWEST_ESTIMATED_COST") {
      const cost = ctx.cost.estimatedCostUsdMicros;
      if (cost === null) {
        sortKey = 9_000_000 + policyIndex;
        reason = "POLICY_PRIORITY";
      } else {
        sortKey = cost;
        reason = "LOWEST_ESTIMATED_COST";
      }
    } else if (strategy === "LOWEST_MEASURED_LATENCY") {
      if (
        ctx.latency.sufficientEvidence &&
        ctx.latency.medianCompletionMs !== null
      ) {
        sortKey = ctx.latency.medianCompletionMs;
        reason = "LOWEST_MEASURED_LATENCY";
      } else if (
        policy.unknownLatencyBehavior === "EXCLUDE_FROM_LATENCY_RANKING"
      ) {
        sortKey = 9_000_000 + policyIndex;
        reason = "POLICY_PRIORITY";
      } else {
        sortKey = policyIndex;
        reason = "POLICY_PRIORITY";
      }
    } else if (strategy === "BALANCED") {
      const rank = balancedRanks?.[contextIndex];
      sortKey =
        rank === undefined ? 9_000_000 + policyIndex : balancedSortKey(rank);
      reason = "BALANCED_SCORE";
    } else if (strategy === "PRIORITY_WITH_FALLBACK") {
      sortKey = policyIndex;
      reason = "POLICY_PRIORITY";
    }

    if (contexts.length === 1) {
      reason = "ONLY_ELIGIBLE_CANDIDATE";
    }

    return { ...ctx, sortKey, reason };
  });

  ranked.sort((a, b) => {
    if (a.sortKey !== b.sortKey) {
      return a.sortKey - b.sortKey;
    }
    const ai = policyRank.get(a.version.id) ?? 9_999;
    const bi = policyRank.get(b.version.id) ?? 9_999;
    return ai - bi;
  });

  return ranked;
}

export function isRetryableRoutingFallback(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const retryable = (error as { retryable?: boolean }).retryable;
  if (retryable === true) {
    return true;
  }
  const code = (error as { code?: string }).code;
  return (
    code === "MODEL_RATE_LIMITED" ||
    code === "MODEL_PROVIDER_UNAVAILABLE" ||
    code === "MODEL_REQUEST_TIMEOUT" ||
    code === "MODEL_PROVIDER_ERROR"
  );
}

export function isNonFallbackRoutingError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = (error as { code?: string }).code;
  return (
    code === "MODEL_AUTHENTICATION_ERROR" ||
    code === "MODEL_INVALID_REQUEST" ||
    code === "MODEL_BINDING_NOT_FOUND" ||
    code === "MODEL_CONTENT_BLOCKED" ||
    code === "MODEL_ROUTING_BUDGET_EXCEEDED" ||
    code === "MODEL_INFERENCE_BUDGET_EXCEEDED" ||
    code === "MODEL_INFERENCE_BUDGET_UNAVAILABLE" ||
    code === "MODEL_ROUTING_NO_ELIGIBLE_CANDIDATE" ||
    code === "MODEL_CANCELLED"
  );
}
