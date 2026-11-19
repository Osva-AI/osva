import type {
  GenerateCompletionRequest,
  GenerateCompletionResult,
  GenerateTextRequest,
  GenerateTextResult,
  InferenceRoutingAttemptRecord,
  InferenceRoutingDecisionRecordV1,
  ModelGateway as ModelGatewayPort,
  ModelStreamEventSource,
} from "@osva-ai/contracts";
import type { ModelProfileVersionId } from "@osva-ai/contracts";
import {
  INFERENCE_MODEL_INVOCATION_SOURCES,
  INFERENCE_ROUTING_POLICY_SCHEMA_VERSION,
  MODEL_ERROR_CODES,
  isModelFinishReason,
} from "@osva-ai/contracts";
import { generateTextInputSchema } from "@osva-ai/contracts/schemas";
import type {
  InferenceRoutingCircuitBreakerRegistry,
  InferenceRoutingLatencyStore,
  ModelProfileRepository,
  ModelProviderConnectionRepository,
} from "@osva/domain";
import {
  InferenceRoutingSelectionError as RoutingSelectionError,
  isNonFallbackRoutingError,
  isRetryableRoutingFallback,
  selectInferenceRoute,
} from "@osva/domain";

import { ModelGatewayError, isModelGatewayError } from "./errors.js";
import { CachingModelGateway } from "./caching-model-gateway.js";
import { ModelGateway } from "./model-gateway.js";
import type { ModelGatewayGenerateTextOptions } from "./provider-adapter.js";
import type { ProviderGenerateTextResult } from "./usage.js";

export type RoutingModelGatewayInner = ModelGateway | CachingModelGateway;

export interface RoutingModelGatewayDependencies {
  readonly inner: RoutingModelGatewayInner;
  readonly modelProfiles: ModelProfileRepository;
  readonly connections?: ModelProviderConnectionRepository;
  readonly circuitBreaker?: InferenceRoutingCircuitBreakerRegistry;
  readonly latencyStore?: InferenceRoutingLatencyStore;
  readonly now?: () => number;
  readonly persistDecision?: (
    decision: InferenceRoutingDecisionRecordV1,
  ) => Promise<void>;
}

export class RoutingModelGateway implements ModelGatewayPort {
  constructor(private readonly deps: RoutingModelGatewayDependencies) {}

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

  generateCompletionStream(
    request: GenerateCompletionRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): ModelStreamEventSource {
    if (!isRoutingActive(options)) {
      return this.deps.inner.generateCompletionStream(request, options);
    }

    return {
      [Symbol.asyncIterator]: () =>
        this.iterateRoutedCompletionStream(request, options),
    };
  }

  private async *iterateRoutedCompletionStream(
    request: GenerateCompletionRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): AsyncGenerator<
    import("@osva-ai/contracts").ModelStreamEvent,
    void,
    undefined
  > {
    const routing = options!.routing!;
    const policy = routing.policy.definition!;
    const policyVersionId = routing.policy.policyVersionId!;

    const selection = await this.resolveRoutingSelection(request, options, {
      requiresStreaming: true,
      hasToolDefinitions: (request.toolDefinitions?.length ?? 0) > 0,
      hasJsonSchema: request.jsonSchema !== undefined,
    });

    const stream = this.deps.inner.generateCompletionStream(
      {
        ...request,
        modelProfileVersionId: selection.primary.modelProfileVersionId,
      },
      options,
    );

    let finalOutcome: "SUCCEEDED" | "FAILED" = "SUCCEEDED";
    try {
      for await (const event of stream) {
        if (event.kind === "FAILED") {
          finalOutcome = "FAILED";
        }
        yield event;
      }
    } catch (error) {
      finalOutcome = "FAILED";
      throw error;
    } finally {
      const decision: InferenceRoutingDecisionRecordV1 = {
        schemaVersion: INFERENCE_ROUTING_POLICY_SCHEMA_VERSION,
        workspaceId: routing.workspaceId,
        policyVersionId,
        strategy: policy.strategy,
        selectedModelProfileVersionId: selection.primary.modelProfileVersionId,
        selectionReason: selection.primary.reason,
        eligibleCandidateCount: selection.eligibleCount,
        fallbackCount: 0,
        providerAttemptCount: 1,
        estimatedCost: selection.primary.estimatedCost,
        attempts: [
          {
            modelProfileVersionId: selection.primary.modelProfileVersionId,
            outcome: finalOutcome,
            estimatedCostUsdMicros:
              selection.primary.estimatedCost.estimatedCostUsdMicros,
          },
        ],
        runId: options?.routing?.runId,
        finalOutcome,
      };
      await this.persistRoutingDecision({ decision });
    }
  }

  async generateTextOutcome(
    request: GenerateTextRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): Promise<ProviderGenerateTextResult> {
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

    if (!isRoutingActive(options)) {
      return this.deps.inner.generateTextOutcome(request, options);
    }

    return this.invokeWithRouting(
      {
        ...request,
        messages: parsed.data.messages,
        maxOutputTokens: parsed.data.maxOutputTokens,
      },
      options,
      {
        requiresStreaming: false,
        hasToolDefinitions: false,
        hasJsonSchema: false,
      },
      (routed) =>
        this.deps.inner.generateTextOutcome(
          routed as GenerateTextRequest,
          options,
        ),
    );
  }

  async generateCompletionOutcome(
    request: GenerateCompletionRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): Promise<ProviderGenerateTextResult> {
    if (!isRoutingActive(options)) {
      return this.deps.inner.generateCompletionOutcome(request, options);
    }

    return this.invokeWithRouting(
      request,
      options,
      {
        requiresStreaming: false,
        hasToolDefinitions: (request.toolDefinitions?.length ?? 0) > 0,
        hasJsonSchema: request.jsonSchema !== undefined,
      },
      (routed) => this.deps.inner.generateCompletionOutcome(routed, options),
    );
  }

  private async resolveRoutingSelection(
    request: GenerateTextRequest | GenerateCompletionRequest,
    options: ModelGatewayGenerateTextOptions | undefined,
    flags: {
      readonly requiresStreaming: boolean;
      readonly hasToolDefinitions: boolean;
      readonly hasJsonSchema: boolean;
    },
  ) {
    const routing = options!.routing!;
    const policy = routing.policy.definition;
    const policyVersionId = routing.policy.policyVersionId;

    if (policy === undefined || policyVersionId === undefined) {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_ROUTING_NO_ELIGIBLE_CANDIDATE,
        "Inference routing is enabled but no policy definition is bound.",
        { retryable: false },
      );
    }

    const atMs = this.deps.now?.() ?? Date.now();
    try {
      return await selectInferenceRoute({
        workspaceId: routing.workspaceId,
        policy,
        messages: request.messages,
        maxOutputTokens: request.maxOutputTokens,
        hasToolDefinitions: flags.hasToolDefinitions,
        hasJsonSchema: flags.hasJsonSchema,
        requiresStreaming: flags.requiresStreaming,
        boundModelProfileVersionId:
          routing.boundModelProfileVersionId ?? request.modelProfileVersionId,
        resolveVersion: (id) =>
          this.deps.modelProfiles.findModelProfileVersionById(id),
        authorizeWorkspace: async (version) => {
          const profile = await this.deps.modelProfiles.findModelProfileById(
            version.modelProfileId,
          );
          return profile?.workspaceId === routing.workspaceId;
        },
        connectionResolvable: async (version) => {
          if (version.modelProviderConnectionVersionId === undefined) {
            return true;
          }
          if (this.deps.connections === undefined) {
            return false;
          }
          const connectionVersion =
            await this.deps.connections.findConnectionVersionById(
              version.modelProviderConnectionVersionId,
            );
          if (connectionVersion === null) {
            return false;
          }
          const connection = await this.deps.connections.findConnectionById(
            connectionVersion.connectionId,
          );
          return connection?.workspaceId === routing.workspaceId;
        },
        circuitBreaker: this.deps.circuitBreaker,
        latencyStore: this.deps.latencyStore,
        atMs,
      });
    } catch (error) {
      if (error instanceof RoutingSelectionError) {
        throw new ModelGatewayError(
          MODEL_ERROR_CODES.MODEL_ROUTING_NO_ELIGIBLE_CANDIDATE,
          "No eligible routing candidate exists for this request.",
          { retryable: false },
        );
      }
      throw error;
    }
  }

  private async invokeWithRouting(
    request: GenerateTextRequest | GenerateCompletionRequest,
    options: ModelGatewayGenerateTextOptions | undefined,
    flags: {
      readonly requiresStreaming: boolean;
      readonly hasToolDefinitions: boolean;
      readonly hasJsonSchema: boolean;
    },
    invoke: (
      routed: GenerateTextRequest | GenerateCompletionRequest,
    ) => Promise<ProviderGenerateTextResult>,
  ): Promise<ProviderGenerateTextResult> {
    const routing = options!.routing!;
    const policy = routing.policy.definition!;
    const policyVersionId = routing.policy.policyVersionId!;

    const selection = await this.resolveRoutingSelection(
      request,
      options,
      flags,
    );

    const maxAttempts = Math.min(
      policy.maxProviderAttempts ?? selection.orderedCandidateIds.length,
      selection.orderedCandidateIds.length,
    );
    const allowFallback = policy.allowFallback === true;

    const attempts: InferenceRoutingAttemptRecord[] = [];
    let fallbackCount = 0;
    let lastError: unknown;

    for (let index = 0; index < maxAttempts; index += 1) {
      const candidateId = selection.orderedCandidateIds[index];
      if (candidateId === undefined) {
        break;
      }
      if (index > 0) {
        if (!allowFallback) {
          break;
        }
        fallbackCount += 1;
      }

      const started = this.deps.now?.() ?? Date.now();
      try {
        const outcome = await invoke({
          ...request,
          modelProfileVersionId: candidateId,
        });

        this.notifyProviderAttempt(options, {
          modelProfileVersionId: candidateId,
          outcome: "SUCCEEDED",
          osvaResponseCacheHit: isOsvaResponseCacheHit(outcome),
        });

        const latencyMs = (this.deps.now?.() ?? Date.now()) - started;
        const successConnectionVersionId =
          await this.resolveConnectionVersionId(candidateId);
        this.deps.circuitBreaker?.observe({
          workspaceId: routing.workspaceId,
          modelProfileVersionId: candidateId,
          connectionVersionId: successConnectionVersionId,
          success: true,
          retryable: false,
          atMs: this.deps.now?.() ?? Date.now(),
        });
        this.deps.latencyStore?.record({
          workspaceId: routing.workspaceId,
          modelProfileVersionId: candidateId,
          completionMs: latencyMs,
          atMs: this.deps.now?.() ?? Date.now(),
        });

        attempts.push({
          modelProfileVersionId: candidateId,
          outcome: "SUCCEEDED",
          completionLatencyMs: latencyMs,
          providerRequestId: outcome.providerRequestId,
          estimatedCostUsdMicros:
            selection.primary.estimatedCost.estimatedCostUsdMicros,
        });

        const decision: InferenceRoutingDecisionRecordV1 = {
          schemaVersion: INFERENCE_ROUTING_POLICY_SCHEMA_VERSION,
          workspaceId: routing.workspaceId,
          policyVersionId,
          strategy: policy.strategy,
          selectedModelProfileVersionId: candidateId,
          selectionReason:
            index === 0
              ? selection.primary.reason
              : "FALLBACK_AFTER_RETRYABLE_FAILURE",
          eligibleCandidateCount: selection.eligibleCount,
          fallbackCount,
          providerAttemptCount: attempts.length,
          estimatedCost: selection.primary.estimatedCost,
          attempts,
          runId: options?.routing?.runId,
          finalOutcome: "SUCCEEDED",
        };

        await this.persistRoutingDecision({ decision });

        return outcome;
      } catch (error) {
        lastError = error;
        this.notifyProviderAttempt(options, {
          modelProfileVersionId: candidateId,
          outcome: "FAILED",
          osvaResponseCacheHit: false,
        });
        const retryable =
          isModelGatewayError(error) && error.retryable === true
            ? true
            : isRetryableRoutingFallback(error);
        if (isNonFallbackRoutingError(error)) {
          attempts.push({
            modelProfileVersionId: candidateId,
            outcome: "FAILED",
            failureCode: isModelGatewayError(error) ? error.code : undefined,
            retryable: false,
          });
          await this.persistRoutingDecision({
            decision: {
              schemaVersion: INFERENCE_ROUTING_POLICY_SCHEMA_VERSION,
              workspaceId: routing.workspaceId,
              policyVersionId,
              strategy: policy.strategy,
              selectedModelProfileVersionId: candidateId,
              selectionReason: selection.primary.reason,
              eligibleCandidateCount: selection.eligibleCount,
              fallbackCount,
              providerAttemptCount: attempts.length,
              estimatedCost: selection.primary.estimatedCost,
              attempts,
              runId: options?.routing?.runId,
              finalOutcome: "FAILED",
            },
          });
          throw error;
        }

        const failureConnectionVersionId =
          await this.resolveConnectionVersionId(candidateId);
        this.deps.circuitBreaker?.observe({
          workspaceId: routing.workspaceId,
          modelProfileVersionId: candidateId,
          connectionVersionId: failureConnectionVersionId,
          success: false,
          retryable,
          atMs: this.deps.now?.() ?? Date.now(),
        });

        attempts.push({
          modelProfileVersionId: candidateId,
          outcome: "FAILED",
          failureCode: isModelGatewayError(error) ? error.code : undefined,
          retryable,
        });

        if (!allowFallback || !retryable) {
          break;
        }
      }
    }

    const decision: InferenceRoutingDecisionRecordV1 = {
      schemaVersion: INFERENCE_ROUTING_POLICY_SCHEMA_VERSION,
      workspaceId: routing.workspaceId,
      policyVersionId,
      strategy: policy.strategy,
      selectedModelProfileVersionId: selection.primary.modelProfileVersionId,
      selectionReason: selection.primary.reason,
      eligibleCandidateCount: selection.eligibleCount,
      fallbackCount,
      providerAttemptCount: attempts.length,
      estimatedCost: selection.primary.estimatedCost,
      attempts,
      runId: options?.routing?.runId,
      finalOutcome: "FAILED",
    };
    await this.persistRoutingDecision({ decision });

    if (lastError !== undefined) {
      throw lastError;
    }

    throw new ModelGatewayError(
      MODEL_ERROR_CODES.MODEL_ROUTING_NO_ELIGIBLE_CANDIDATE,
      "Routing candidates were exhausted.",
      { retryable: false },
    );
  }

  private async resolveConnectionVersionId(
    modelProfileVersionId: ModelProfileVersionId,
  ): Promise<
    import("@osva-ai/contracts").ModelProviderConnectionVersionId | undefined
  > {
    const version = await this.deps.modelProfiles.findModelProfileVersionById(
      modelProfileVersionId,
    );
    return version?.modelProviderConnectionVersionId;
  }

  private notifyProviderAttempt(
    options: ModelGatewayGenerateTextOptions | undefined,
    observation: import("./provider-adapter.js").RoutingProviderAttemptObservation,
  ): void {
    options?.routing?.onProviderAttempt?.(observation);
  }

  private async persistRoutingDecision(input: {
    readonly decision: InferenceRoutingDecisionRecordV1;
  }): Promise<void> {
    if (this.deps.persistDecision === undefined) {
      return;
    }
    try {
      await this.deps.persistDecision(input.decision);
    } catch (error) {
      if (isModelGatewayError(error)) {
        throw error;
      }
    }
  }
}

function isOsvaResponseCacheHit(outcome: ProviderGenerateTextResult): boolean {
  return outcome.invocationSource === INFERENCE_MODEL_INVOCATION_SOURCES[2];
}

function isRoutingActive(options?: ModelGatewayGenerateTextOptions): boolean {
  const routing = options?.routing;
  return (
    routing !== undefined &&
    routing.policy.enabled === true &&
    routing.policy.definition !== undefined
  );
}
