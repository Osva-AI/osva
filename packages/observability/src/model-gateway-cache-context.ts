import type {
  ExecutionRequest,
  ModelProfileVersionId,
} from "@osva-ai/contracts";
import type {
  InferenceCacheExecutionPurpose,
  InferenceResponseCachePolicyV1,
} from "@osva-ai/contracts";
import { inferenceResponseCachePolicySchema } from "@osva-ai/contracts/schemas";
import type { ModelGatewayGenerateTextOptions } from "@osva/model-gateway";

import {
  mergeModelGatewayGenerateOptions,
  resolveModelGatewayRoutingContext,
} from "./model-gateway-routing-context.js";

const INFERENCE_RESPONSE_CACHE_POLICY_CONTEXT_KEY =
  "inferenceResponseCache" as const;

function executionPurpose(
  execution: ExecutionRequest,
): InferenceCacheExecutionPurpose {
  if (execution.evaluationContext !== undefined) {
    return "EVALUATION_JUDGE";
  }
  return "AGENT_RUN";
}

function readInferenceResponseCachePolicy(
  execution: ExecutionRequest,
): InferenceResponseCachePolicyV1 | undefined {
  const raw =
    execution.policyContext[INFERENCE_RESPONSE_CACHE_POLICY_CONTEXT_KEY];
  if (raw === undefined || raw === null || typeof raw !== "object") {
    return undefined;
  }

  const parsed = inferenceResponseCachePolicySchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function resolveModelGatewayGenerateOptions(
  execution: ExecutionRequest,
  options?: {
    readonly signal?: AbortSignal;
    readonly boundModelProfileVersionId?: ModelProfileVersionId;
  },
): ModelGatewayGenerateTextOptions | undefined {
  const policy = readInferenceResponseCachePolicy(execution);
  const cacheOptions =
    policy === undefined || policy.enabled !== true
      ? options
      : {
          ...options,
          cache: {
            workspaceId: execution.workspaceId,
            executionPurpose: executionPurpose(execution),
            policy,
          },
        };

  const routingOptions = resolveModelGatewayRoutingContext(
    execution,
    options?.boundModelProfileVersionId ?? undefined,
    options,
  );

  return mergeModelGatewayGenerateOptions(cacheOptions, routingOptions);
}

export function isOsvaResponseCacheHitOutcome(
  outcome: { readonly invocationSource?: string } | undefined,
): boolean {
  return outcome?.invocationSource === "OSVA_RESPONSE_CACHE_HIT";
}
