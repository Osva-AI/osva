import type {
  InferenceResponseCachePolicyV1,
  InferenceRoutingRuntimePolicyV1,
  JsonSchemaRecord,
  ModelConversationMessage,
  ModelProfileVersionId,
  ModelToolDefinition,
  WorkspaceId,
} from "@osva-ai/contracts";
export type { ModelGatewayBudgetContext } from "./model-gateway-budget-context.js";
import type { ModelGatewayBudgetContext } from "./model-gateway-budget-context.js";
import type {
  InferenceCacheExecutionPurpose,
  ModelStreamEventSource,
} from "@osva-ai/contracts";

import type { ProviderGenerateTextResult } from "./usage.js";

/**
 * Provider-neutral request after ModelGateway has loaded the immutable
 * ModelProfileVersion. The concrete provider model ID is allowed here because
 * this is already below the provider-routing boundary. SDK types are not.
 */
export interface ResolvedProviderGenerateTextRequest {
  readonly model: string;
  readonly messages: readonly ModelConversationMessage[];
  readonly maxOutputTokens?: number;
  readonly toolDefinitions?: readonly ModelToolDefinition[];
  readonly jsonSchema?: JsonSchemaRecord;
  readonly signal?: AbortSignal;
}

/**
 * Internal execution cancellation. Not part of the public GenerateTextRequest
 * contract or runtime IPC.
 */
export interface ModelGatewayCacheContext {
  readonly workspaceId: WorkspaceId;
  readonly executionPurpose: InferenceCacheExecutionPurpose;
  readonly policy: InferenceResponseCachePolicyV1;
}

export interface RoutingProviderAttemptObservation {
  readonly modelProfileVersionId: ModelProfileVersionId;
  readonly outcome: "SUCCEEDED" | "FAILED";
  /** True when OSVA exact-response cache served the attempt (not a provider round-trip). */
  readonly osvaResponseCacheHit: boolean;
}

export interface ModelGatewayRoutingContext {
  readonly workspaceId: WorkspaceId;
  readonly policy: InferenceRoutingRuntimePolicyV1;
  readonly boundModelProfileVersionId?: ModelProfileVersionId;
  readonly runId?: import("@osva-ai/contracts").RunId;
  readonly onProviderAttempt?: (
    observation: RoutingProviderAttemptObservation,
  ) => void;
}

export interface ModelGatewayGenerateTextOptions {
  readonly signal?: AbortSignal;
  readonly cache?: ModelGatewayCacheContext;
  readonly routing?: ModelGatewayRoutingContext;
  readonly budget?: ModelGatewayBudgetContext;
}

/** Internal outcome-level port used by caching, routing, and budget decorators. */
export interface ModelGatewayInvokePort {
  generateTextOutcome(
    request: import("@osva-ai/contracts").GenerateTextRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): Promise<import("./usage.js").ProviderGenerateTextResult>;
  generateCompletionOutcome(
    request: import("@osva-ai/contracts").GenerateCompletionRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): Promise<import("./usage.js").ProviderGenerateTextResult>;
  generateCompletionStream(
    request: import("@osva-ai/contracts").GenerateCompletionRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): import("@osva-ai/contracts").ModelStreamEventSource;
}

export interface ModelProviderAdapter {
  generateText(
    request: ResolvedProviderGenerateTextRequest,
  ): Promise<ProviderGenerateTextResult>;
  /**
   * Native provider streaming. When omitted, ModelGateway reports streaming as
   * unavailable for that adapter.
   */
  generateCompletionStream?(
    request: ResolvedProviderGenerateTextRequest,
  ): ModelStreamEventSource;
}
