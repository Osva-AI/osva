import type {
  GenerateCompletionRequest,
  GenerateCompletionResult,
  GenerateTextRequest,
  GenerateTextResult,
  InferenceResponseCachePolicyV1,
  ModelGateway as ModelGatewayPort,
  ModelStreamEventSource,
} from "@osva-ai/contracts";
import {
  INFERENCE_CACHE_DEFAULT_TTL_SECONDS,
  INFERENCE_MODEL_INVOCATION_SOURCES,
  MODEL_ERROR_CODES,
  isModelFinishReason,
} from "@osva-ai/contracts";
import { generateTextInputSchema } from "@osva-ai/contracts/schemas";
import type {
  ExactResponseCachePort,
  InferenceCacheLookupInput,
  InferenceCacheStoreInput,
} from "@osva-ai/contracts";
import {
  buildInferenceCacheIdentity,
  evaluateInferenceCacheLookupEligibility,
  evaluateInferenceCacheStoreEligibility,
} from "@osva/domain";
import type { ModelProfileRepository } from "@osva/domain";

import { ModelGatewayError } from "./errors.js";
import type {
  ModelGatewayGenerateTextOptions,
  ModelGatewayInvokePort,
} from "./provider-adapter.js";
import type { ProviderGenerateTextResult } from "./usage.js";

export interface CachingModelGatewayDependencies {
  readonly inner: ModelGatewayInvokePort;
  readonly modelProfiles: ModelProfileRepository;
  readonly cache?: ExactResponseCachePort;
  readonly defaultTtlSeconds?: number;
}

/**
 * Optional exact-response cache decorator. Default-off unless
 * {@link ModelGatewayGenerateTextOptions.cache} carries an enabled policy and
 * {@link CachingModelGatewayDependencies.cache} is configured.
 */
export class CachingModelGateway implements ModelGatewayPort {
  constructor(private readonly deps: CachingModelGatewayDependencies) {}

  async generateText(
    request: GenerateTextRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): Promise<GenerateTextResult> {
    const outcome = await this.generateTextOutcome(request, options);
    if (outcome.text === undefined || outcome.text.trim().length === 0) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
        "The model provider returned no textual output.",
      );
    }
    return { text: outcome.text };
  }

  generateCompletionStream(
    request: GenerateCompletionRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): ModelStreamEventSource {
    assertNotAborted(options?.signal);
    return this.deps.inner.generateCompletionStream(request, options);
  }

  async generateCompletion(
    request: GenerateCompletionRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): Promise<GenerateCompletionResult> {
    const outcome = await this.generateCompletionOutcome(request, options);
    const finishReason =
      outcome.finishReason !== undefined &&
      isModelFinishReason(outcome.finishReason)
        ? outcome.finishReason
        : "other";

    const usage =
      outcome.usage !== undefined
        ? {
            inputUnits: outcome.usage.inputTokens,
            outputUnits: outcome.usage.outputTokens,
            cachedUnits: outcome.usage.cachedInputTokens,
          }
        : undefined;

    return {
      text: outcome.text,
      toolCalls: outcome.toolCalls ?? [],
      finishReason,
      usage,
    };
  }

  async generateTextOutcome(
    request: GenerateTextRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): Promise<ProviderGenerateTextResult> {
    assertNotAborted(options?.signal);

    const parsed = generateTextInputSchema.safeParse({
      messages: request.messages,
      maxOutputTokens: request.maxOutputTokens,
    });
    if (!parsed.success) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
        "Model generateText request is invalid.",
      );
    }

    const cacheLayer = await this.tryCacheRead({
      request,
      messages: parsed.data.messages,
      maxOutputTokens: parsed.data.maxOutputTokens,
      options,
    });
    if (cacheLayer !== undefined) {
      return cacheLayer;
    }

    const providerOutcome = await this.deps.inner.generateTextOutcome(
      request,
      options,
    );

    const tagged = tagProviderInvocationSource(providerOutcome);
    await this.tryCacheWrite({
      request,
      messages: parsed.data.messages,
      maxOutputTokens: parsed.data.maxOutputTokens,
      options,
      providerOutcome: tagged,
    });

    return tagged;
  }

  async generateCompletionOutcome(
    request: GenerateCompletionRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): Promise<ProviderGenerateTextResult> {
    assertNotAborted(options?.signal);
    return tagProviderInvocationSource(
      await this.deps.inner.generateCompletionOutcome(request, options),
    );
  }

  private async tryCacheRead(input: {
    readonly request: GenerateTextRequest;
    readonly messages: GenerateTextRequest["messages"];
    readonly maxOutputTokens?: number;
    readonly options?: ModelGatewayGenerateTextOptions;
  }): Promise<ProviderGenerateTextResult | undefined> {
    const plan = await this.buildCachePlan(input);
    if (plan === undefined) {
      return undefined;
    }

    assertNotAborted(input.options?.signal);

    const lookup = await this.deps.cache!.lookup(
      {
        workspaceId: plan.lookup.workspaceId,
        storageKey: plan.identity.storageKey,
        identityDigest: plan.identity.identityDigest,
      },
      cancellationFrom(input.options),
    );

    assertNotAborted(input.options?.signal);

    if (lookup.outcome === "corrupt") {
      return undefined;
    }

    if (lookup.outcome === "bypass" && lookup.reason === "UNAUTHORIZED") {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_CACHE_UNAUTHORIZED,
        "Exact-response cache authorization failed.",
        { retryable: false },
      );
    }

    if (lookup.outcome === "hit") {
      const text = lookup.entry.body.text;
      if (text === undefined || text.trim().length === 0) {
        return undefined;
      }
      return {
        text,
        finishReason: lookup.entry.body.finishReason ?? "stop",
        invocationSource: INFERENCE_MODEL_INVOCATION_SOURCES[2],
        estimatedAvoidedCostUsdMicros: null,
      };
    }

    return undefined;
  }

  private async tryCacheWrite(input: {
    readonly request: GenerateTextRequest;
    readonly messages: GenerateTextRequest["messages"];
    readonly maxOutputTokens?: number;
    readonly options?: ModelGatewayGenerateTextOptions;
    readonly providerOutcome: ProviderGenerateTextResult;
  }): Promise<void> {
    const plan = await this.buildCachePlan(input);
    if (plan === undefined || this.deps.cache === undefined) {
      return;
    }

    if (
      input.providerOutcome.invocationSource ===
      INFERENCE_MODEL_INVOCATION_SOURCES[2]
    ) {
      return;
    }

    const storeInput: InferenceCacheStoreInput = {
      ...plan.lookup,
      terminalStatus: "SUCCEEDED",
      cancelled: false,
      response: {
        text: input.providerOutcome.text,
        finishReason: input.providerOutcome.finishReason,
      },
    };

    if (evaluateInferenceCacheStoreEligibility(storeInput).eligible !== true) {
      return;
    }

    const ttl =
      plan.lookup.policy.ttlSeconds ??
      this.deps.defaultTtlSeconds ??
      INFERENCE_CACHE_DEFAULT_TTL_SECONDS;

    await this.deps.cache.putIfAbsent(
      {
        workspaceId: plan.lookup.workspaceId,
        storageKey: plan.identity.storageKey,
        identityDigest: plan.identity.identityDigest,
        ttlSeconds: ttl,
        entry: {
          identityDigest: plan.identity.identityDigest,
          cachedAt: new Date().toISOString(),
          body: storeInput.response,
        },
      },
      cancellationFrom(input.options),
    );
  }

  private async buildCachePlan(input: {
    readonly request: GenerateTextRequest;
    readonly messages: GenerateTextRequest["messages"];
    readonly maxOutputTokens?: number;
    readonly options?: ModelGatewayGenerateTextOptions;
  }): Promise<
    | {
        readonly identity: NonNullable<
          ReturnType<typeof buildInferenceCacheIdentity>
        >;
        readonly lookup: InferenceCacheLookupInput;
      }
    | undefined
  > {
    if (this.deps.cache === undefined || input.options?.cache === undefined) {
      return undefined;
    }

    const cacheContext = input.options.cache;
    if (!isCacheActive(cacheContext.policy)) {
      return undefined;
    }

    const version = await this.deps.modelProfiles.findModelProfileVersionById(
      input.request.modelProfileVersionId,
    );
    if (version === null) {
      return undefined;
    }

    if (version.modelProviderConnectionVersionId === undefined) {
      return undefined;
    }

    const lookup: InferenceCacheLookupInput = {
      workspaceId: cacheContext.workspaceId,
      executionPurpose: cacheContext.executionPurpose,
      policy: cacheContext.policy,
      modelProfileVersionId: input.request.modelProfileVersionId,
      modelProviderConnectionVersionId:
        version.modelProviderConnectionVersionId,
      provider: version.provider,
      configuredModelId: version.model,
      messages: input.messages,
      maxOutputTokens: input.maxOutputTokens,
    };

    if (!evaluateInferenceCacheLookupEligibility(lookup).eligible) {
      return undefined;
    }

    const identity = buildInferenceCacheIdentity({
      workspaceId: cacheContext.workspaceId,
      material: {
        modelProfileVersionId: input.request.modelProfileVersionId,
        modelProviderConnectionVersionId:
          version.modelProviderConnectionVersionId,
        provider: version.provider,
        configuredModelId: version.model,
        messages: input.messages,
        maxOutputTokens: input.maxOutputTokens,
        cachePolicyVersionId: cacheContext.policy.cachePolicyRevisionId,
      },
    });
    if (identity === undefined) {
      return undefined;
    }

    return { identity, lookup };
  }
}

function isCacheActive(policy: InferenceResponseCachePolicyV1): boolean {
  return policy.enabled && policy.determinism === "REQUIRED_DETERMINISTIC";
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_CANCELLED,
      "Model generation was cancelled.",
      { retryable: false },
    );
  }
}

function cancellationFrom(
  options: ModelGatewayGenerateTextOptions | undefined,
) {
  return options?.signal === undefined ? undefined : { signal: options.signal };
}

function tagProviderInvocationSource(
  outcome: ProviderGenerateTextResult,
): ProviderGenerateTextResult {
  if (
    outcome.invocationSource === INFERENCE_MODEL_INVOCATION_SOURCES[2] ||
    outcome.invocationSource === INFERENCE_MODEL_INVOCATION_SOURCES[1]
  ) {
    return outcome;
  }

  const cached =
    outcome.usage?.cachedInputTokens !== undefined &&
    outcome.usage.cachedInputTokens > 0;

  return {
    ...outcome,
    invocationSource: cached
      ? INFERENCE_MODEL_INVOCATION_SOURCES[1]
      : INFERENCE_MODEL_INVOCATION_SOURCES[0],
  };
}
