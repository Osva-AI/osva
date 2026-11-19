import type {
  ModelProfileVersionId,
  ModelProviderConnectionVersionId,
  WorkspaceId,
} from "./ids.js";
import type {
  GenerateCompletionInput,
  ModelConversationMessage,
  ModelFinishReason,
  ModelProvider,
  ModelToolCall,
  ModelToolDefinition,
} from "./model-gateway.js";
import type { JsonSchemaRecord } from "./json-schema.js";

/**
 * Canonical exact-response cache identity format. Bump when identity material changes.
 */
export const INFERENCE_CACHE_IDENTITY_FORMAT_VERSION = "1" as const;

export type InferenceCacheIdentityFormatVersion =
  typeof INFERENCE_CACHE_IDENTITY_FORMAT_VERSION;

/**
 * Sentinel recorded in cache identity when ModelProfileVersion uses a legacy
 * environment adapter instead of a connection version row.
 */
export const INFERENCE_CACHE_LEGACY_CONNECTION_SENTINEL =
  "legacy-provider-env-adapter" as const;

export const INFERENCE_RESPONSE_CACHE_POLICY_SCHEMA_VERSION = "1" as const;

/**
 * Workspace-scoped response cache policy. Default in product: `enabled: false`.
 */
/**
 * Authoritative workspace-scoped cache policy persisted by OSVA (not runtime input).
 */
export interface WorkspaceInferenceCachePolicyRecordV1 {
  readonly schemaVersion: typeof INFERENCE_RESPONSE_CACHE_POLICY_SCHEMA_VERSION;
  readonly workspaceId: WorkspaceId;
  readonly enabled: boolean;
  readonly determinism: "PROVIDER_DEFAULT" | "REQUIRED_DETERMINISTIC";
  readonly ttlSeconds?: number;
  readonly revokedAt?: string;
  readonly updatedAt: string;
}

export interface InferenceResponseCachePolicyV1 {
  readonly schemaVersion: typeof INFERENCE_RESPONSE_CACHE_POLICY_SCHEMA_VERSION;
  /**
   * Master switch. When false, all cache decisions are ineligible without
   * evaluating request material.
   */
  readonly enabled: boolean;
  readonly ttlSeconds?: number;
  /**
   * `REQUIRED_DETERMINISTIC` is required before caching is allowed when
   * `enabled` is true. `PROVIDER_DEFAULT` keeps cache off (fail-closed for
   * stochastic provider behavior).
   */
  readonly determinism: "PROVIDER_DEFAULT" | "REQUIRED_DETERMINISTIC";
  /** Defaults to false. Evaluation judge calls must not populate exact cache. */
  readonly allowEvaluationJudgeCache?: boolean;
  /**
   * Defaults to false. Tool definitions and tool-role messages remain
   * ineligible unless explicitly approved.
   */
  readonly allowToolDefinitions?: boolean;
  readonly maxEntryBytes?: number;
  /**
   * Server-owned revision bound into cache identity. Changes when workspace
   * policy is upserted, revoked, or re-enabled.
   */
  readonly cachePolicyRevisionId?: string;
}

export const INFERENCE_CACHE_EXECUTION_PURPOSES = [
  "AGENT_RUN",
  "EVALUATION_JUDGE",
  "EVALUATION_PAIRWISE",
  "BUILDER",
  "CONNECTION_TEST",
  "OTHER",
] as const;

export type InferenceCacheExecutionPurpose =
  (typeof INFERENCE_CACHE_EXECUTION_PURPOSES)[number];

export const INFERENCE_CACHE_ELIGIBILITY_REASONS = [
  "ELIGIBLE",
  "POLICY_DISABLED",
  "POLICY_NOT_AUTHORIZED",
  "NON_DETERMINISTIC",
  "EVALUATION_JUDGE_FORBIDDEN",
  "TOOL_LOOP_FORBIDDEN",
  "TOOL_DEFINITIONS_FORBIDDEN",
  "SIDE_EFFECTFUL_TOOLS",
  "IDENTITY_INCOMPLETE",
  "REQUEST_INVALID",
  "RESPONSE_NOT_TERMINAL",
  "RESPONSE_FAILED",
  "RESPONSE_CANCELLED",
  "RESPONSE_PARTIAL",
  "RESPONSE_EMPTY",
  "SENSITIVE_OPERATION",
] as const;

export type InferenceCacheEligibilityReason =
  (typeof INFERENCE_CACHE_ELIGIBILITY_REASONS)[number];

export interface InferenceCacheEligibilityDecision {
  readonly eligible: boolean;
  readonly reason: InferenceCacheEligibilityReason;
}

/**
 * Trusted execution context. `workspaceId` must come from OSVA authorization,
 * never from an untrusted model request payload alone.
 */
export interface InferenceCacheAuthorizedContext {
  readonly workspaceId: WorkspaceId;
  readonly executionPurpose: InferenceCacheExecutionPurpose;
}

/**
 * Output-affecting request material used for canonical cache identity.
 */
export interface InferenceCacheRequestMaterial {
  readonly modelProfileVersionId: ModelProfileVersionId;
  readonly modelProviderConnectionVersionId?:
    ModelProviderConnectionVersionId | undefined;
  readonly provider: ModelProvider;
  readonly configuredModelId: string;
  readonly messages: readonly ModelConversationMessage[];
  readonly maxOutputTokens?: number;
  readonly toolDefinitions?: readonly ModelToolDefinition[];
  readonly jsonSchema?: JsonSchemaRecord;
  readonly cachePolicyVersionId?: string;
  readonly routingPolicyVersionId?: string;
}

export type InferenceCacheLookupInput = InferenceCacheAuthorizedContext &
  InferenceCacheRequestMaterial & {
    readonly policy: InferenceResponseCachePolicyV1;
  };

export interface InferenceCacheStoreInput extends InferenceCacheLookupInput {
  readonly terminalStatus: "SUCCEEDED";
  readonly cancelled?: boolean;
  readonly response: InferenceCacheStorableResponse;
}

export interface InferenceCacheStorableResponse {
  readonly text?: string;
  readonly toolCalls?: readonly ModelToolCall[];
  readonly finishReason?: ModelFinishReason;
}

/**
 * Domain-separated digest for a cache identity. Does not contain prompts.
 * Format: `inference-cache-identity-v1:sha256:<64 lowercase hex>`
 */
export type InferenceCacheIdentityDigest = string;

export const INFERENCE_CACHE_IDENTITY_DIGEST_PREFIX =
  "inference-cache-identity-v1:sha256:" as const;

/**
 * Valkey-safe storage key (workspace namespaced). Does not embed prompt text.
 */
export type InferenceCacheStorageKey = string;

export const INFERENCE_CACHE_STORAGE_KEY_PREFIX = "osva:erc:v1:" as const;

/**
 * Distinguishes how a model step should be accounted in future RunStep metadata.
 *
 * - `PROVIDER_INVOKED`: provider HTTP/SDK call occurred (uncached input).
 * - `PROVIDER_PROMPT_CACHE_HIT`: provider invoked; usage reports cached input tokens.
 * - `OSVA_RESPONSE_CACHE_HIT`: provider not invoked; no provider token usage.
 */
export const INFERENCE_MODEL_INVOCATION_SOURCES = [
  "PROVIDER_INVOKED",
  "PROVIDER_PROMPT_CACHE_HIT",
  "OSVA_RESPONSE_CACHE_HIT",
] as const;

export type InferenceModelInvocationSource =
  (typeof INFERENCE_MODEL_INVOCATION_SOURCES)[number];

/**
 * Optional future RunStep field: estimated savings from an OSVA response cache hit.
 * Not a provider cost and not a substitute for `estimatedCostUsdMicros` on misses.
 */
export interface InferenceAvoidedCostEstimate {
  readonly kind: "ESTIMATED_AVOIDED_PROVIDER_COST";
  readonly estimatedAvoidedCostUsdMicros: number | null;
  readonly basis: "MODEL_PROFILE_PRICING_SNAPSHOT";
}

export const INFERENCE_CACHE_BYPASS_REASONS = [
  "INFRASTRUCTURE_UNAVAILABLE",
  "POLICY_BYPASS",
  "IDENTITY_UNAVAILABLE",
  "ENTRY_TOO_LARGE",
  "UNAUTHORIZED",
  "ENCRYPTION_FAILURE",
  "POLICY_DISABLED",
] as const;

/** Wire format for AES-GCM encrypted exact-response cache payloads in Valkey. */
export const INFERENCE_CACHE_ENCRYPTED_WIRE_FORMAT_VERSION = "1" as const;

export const INFERENCE_CACHE_ENTRY_FORMAT_VERSION = "1" as const;

export type InferenceCacheEntryFormatVersion =
  typeof INFERENCE_CACHE_ENTRY_FORMAT_VERSION;

/** Minimum TTL when storing exact-response cache entries. */
export const INFERENCE_CACHE_MIN_TTL_SECONDS = 60;

/** Maximum TTL when storing exact-response cache entries. */
export const INFERENCE_CACHE_MAX_TTL_SECONDS = 7 * 24 * 60 * 60;

export const INFERENCE_CACHE_DEFAULT_TTL_SECONDS = 3_600;

export type InferenceCacheBypassReason =
  (typeof INFERENCE_CACHE_BYPASS_REASONS)[number];

export const INFERENCE_CACHE_DEFAULT_MAX_ENTRY_BYTES = 256 * 1024;

export interface ExactResponseCacheEntry {
  readonly identityDigest: InferenceCacheIdentityDigest;
  readonly cachedAt: string;
  readonly body: InferenceCacheStorableResponse;
}

export type ExactResponseCacheLookupResult =
  | { readonly outcome: "miss" }
  | { readonly outcome: "hit"; readonly entry: ExactResponseCacheEntry }
  | {
      readonly outcome: "bypass";
      readonly reason: InferenceCacheBypassReason;
    }
  | { readonly outcome: "corrupt"; readonly identityDigest: string };

export type ExactResponseCachePutResult =
  | { readonly outcome: "created" }
  | { readonly outcome: "exists" }
  | {
      readonly outcome: "bypass";
      readonly reason: InferenceCacheBypassReason;
    }
  | {
      readonly outcome: "rejected";
      readonly reason: InferenceCacheEligibilityReason;
    };

export interface ExactResponseCacheLookupRequest {
  /** Trusted workspace from OSVA authorization; must match the storage key. */
  readonly workspaceId: WorkspaceId;
  readonly storageKey: InferenceCacheStorageKey;
  readonly identityDigest: InferenceCacheIdentityDigest;
}

export interface ExactResponseCachePutRequest {
  /** Trusted workspace from OSVA authorization; must match the storage key. */
  readonly workspaceId: WorkspaceId;
  readonly storageKey: InferenceCacheStorageKey;
  readonly identityDigest: InferenceCacheIdentityDigest;
  readonly ttlSeconds: number;
  readonly entry: ExactResponseCacheEntry;
}

/**
 * Storage-independent exact-response cache port. Infrastructure failures must
 * surface as `bypass` outcomes, not skip authorization.
 */
export interface InferenceCacheCancellationSignal {
  readonly aborted: boolean;
}

export interface ExactResponseCachePort {
  lookup(
    request: ExactResponseCacheLookupRequest,
    options?: { readonly signal?: InferenceCacheCancellationSignal },
  ): Promise<ExactResponseCacheLookupResult>;

  putIfAbsent(
    request: ExactResponseCachePutRequest,
    options?: { readonly signal?: InferenceCacheCancellationSignal },
  ): Promise<ExactResponseCachePutResult>;
}

/**
 * Convenience shape aligning cache identity with gateway completion input.
 */
export type InferenceCacheRequestFromCompletion = Pick<
  GenerateCompletionInput,
  "messages" | "maxOutputTokens" | "toolDefinitions" | "jsonSchema"
>;

export function createDefaultInferenceResponseCachePolicy(): InferenceResponseCachePolicyV1 {
  return {
    schemaVersion: INFERENCE_RESPONSE_CACHE_POLICY_SCHEMA_VERSION,
    enabled: false,
    determinism: "PROVIDER_DEFAULT",
  };
}
