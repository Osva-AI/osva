import type { ExecutionRequest } from "@osva-ai/contracts";
import type { InferenceRoutingRuntimePolicyV1 } from "@osva-ai/contracts";
import { inferenceRoutingRuntimePolicySchema } from "@osva-ai/contracts/schemas";
import type { ModelGatewayGenerateTextOptions } from "@osva/model-gateway";

const INFERENCE_ROUTING_POLICY_CONTEXT_KEY = "inferenceRouting" as const;

function readInferenceRoutingPolicy(
  execution: ExecutionRequest,
): InferenceRoutingRuntimePolicyV1 | undefined {
  const raw = execution.policyContext[INFERENCE_ROUTING_POLICY_CONTEXT_KEY];
  if (raw === undefined || raw === null || typeof raw !== "object") {
    return undefined;
  }

  const parsed = inferenceRoutingRuntimePolicySchema.safeParse(raw);
  return parsed.success
    ? (parsed.data as InferenceRoutingRuntimePolicyV1)
    : undefined;
}

export function resolveModelGatewayRoutingContext(
  execution: ExecutionRequest,
  boundModelProfileVersionId:
    import("@osva-ai/contracts").ModelProfileVersionId | undefined,
  options?: { readonly signal?: AbortSignal },
): ModelGatewayGenerateTextOptions | undefined {
  const policy = readInferenceRoutingPolicy(execution);
  if (
    policy === undefined ||
    policy.enabled !== true ||
    execution.evaluationContext !== undefined
  ) {
    return options;
  }

  const cacheOptions = options;
  return {
    ...cacheOptions,
    routing: {
      workspaceId: execution.workspaceId,
      policy,
      boundModelProfileVersionId,
      runId: execution.runId,
    },
  };
}

export function mergeModelGatewayGenerateOptions(
  cacheOptions: ModelGatewayGenerateTextOptions | undefined,
  routingOptions: ModelGatewayGenerateTextOptions | undefined,
): ModelGatewayGenerateTextOptions | undefined {
  if (cacheOptions === undefined && routingOptions === undefined) {
    return undefined;
  }
  return {
    ...cacheOptions,
    ...routingOptions,
    cache: cacheOptions?.cache ?? routingOptions?.cache,
    routing: routingOptions?.routing ?? cacheOptions?.routing,
    signal: cacheOptions?.signal ?? routingOptions?.signal,
    budget: routingOptions?.budget ?? cacheOptions?.budget,
  };
}
