import type {
  GenerateCompletionRequest,
  GenerateCompletionResult,
  GenerateTextRequest,
  GenerateTextResult,
  InferenceRoutingAttemptRecord,
  InferenceRoutingCostEstimate,
  InferenceRoutingDecisionRecordV1,
  ModelGateway as ModelGatewayPort,
  ModelStreamEvent,
  ModelStreamEventSource,
} from "@osva-ai/contracts";
import type { ModelProfileVersionId } from "@osva-ai/contracts";
import {
  INFERENCE_MODEL_INVOCATION_SOURCES,
  INFERENCE_ROUTING_POLICY_SCHEMA_VERSION,
  MODEL_ERROR_CODES,
  estimateRoutingInputTokens,
  estimateRoutingPreflightCostUsdMicros,
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
import { mergeProviderAttemptBudgetOptions } from "./model-gateway-budget-context.js";
import { ModelGateway } from "./model-gateway.js";
import type { ModelGatewayGenerateTextOptions } from "./provider-adapter.js";
import type { ProviderGenerateTextResult } from "./usage.js";

export type RoutingModelGatewayInner =
  | ModelGateway
  | CachingModelGateway
  | import("./budget-enforcing-model-gateway.js").BudgetEnforcingModelGateway;

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
  ): AsyncGenerator<ModelStreamEvent, void, undefined> {
    const routing = options!.routing!;
    const policy = routing.policy.definition!;
    const policyVersionId = routing.policy.policyVersionId!;

    const selection = await this.resolveRoutingSelection(request, options, {
      requiresStreaming: true,
      hasToolDefinitions: (request.toolDefinitions?.length ?? 0) > 0,
      hasJsonSchema: request.jsonSchema !== undefined,
    });

    const maxAttempts = Math.min(
      policy.maxProviderAttempts ?? selection.orderedCandidateIds.length,
      selection.orderedCandidateIds.length,
    );
    const allowFallback = policy.allowFallback === true;

    const attempts: InferenceRoutingAttemptRecord[] = [];
    let fallbackCount = 0;
    let lastError: unknown;

    attemptLoop: for (let index = 0; index < maxAttempts; index += 1) {
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
      const attemptOptions = mergeProviderAttemptBudgetOptions(options, {
        providerAttemptIndex: index,
        selectedModelProfileVersionId: candidateId,
      });
      const candidateCost = await this.estimateCandidatePreflightCost(
        request,
        candidateId,
      );

      let consumerOutputEmitted = false;
      let forwardedToConsumer = false;
      let providerEventsSeen = 0;

      try {
        const stream = this.deps.inner.generateCompletionStream(
          {
            ...request,
            modelProfileVersionId: candidateId,
          },
          attemptOptions,
        );

        for await (const event of stream) {
          providerEventsSeen += 1;
          if (event.kind === "FAILED" && !consumerOutputEmitted) {
            const failure = modelStreamFailedEventToError(event);
            lastError = failure;
            this.notifyProviderAttempt(options, {
              modelProfileVersionId: candidateId,
              outcome: "FAILED",
              osvaResponseCacheHit: false,
            });
            const failureConnectionVersionId =
              await this.resolveConnectionVersionId(candidateId);
            const retryable = isStreamingPreOutputFallbackEligible(failure);
            if (isNonFallbackRoutingError(failure)) {
              attempts.push({
                modelProfileVersionId: candidateId,
                outcome: "FAILED",
                failureCode: failure.code,
                retryable: false,
                estimatedCostUsdMicros: candidateCost.estimatedCostUsdMicros,
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
                  estimatedCost: candidateCost,
                  attempts,
                  runId: options?.routing?.runId,
                  finalOutcome: "FAILED",
                },
              });
              throw failure;
            }
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
              failureCode: failure.code,
              retryable,
              estimatedCostUsdMicros: candidateCost.estimatedCostUsdMicros,
            });
            if (!allowFallback || !retryable) {
              break attemptLoop;
            }
            continue attemptLoop;
          }

          if (event.kind === "CANCELLED") {
            forwardedToConsumer = true;
            yield event;
            this.notifyProviderAttempt(options, {
              modelProfileVersionId: candidateId,
              outcome: "FAILED",
              osvaResponseCacheHit: false,
            });
            const latencyMs = (this.deps.now?.() ?? Date.now()) - started;
            attempts.push({
              modelProfileVersionId: candidateId,
              outcome: "FAILED",
              completionLatencyMs: latencyMs,
              failureCode: MODEL_ERROR_CODES.MODEL_CANCELLED,
              retryable: false,
              estimatedCostUsdMicros: candidateCost.estimatedCostUsdMicros,
            });
            await this.persistRoutingDecision({
              decision: {
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
                estimatedCost: candidateCost,
                attempts,
                runId: options?.routing?.runId,
                finalOutcome: "FAILED",
              },
            });
            return;
          }

          if (isConsumerVisibleStreamOutput(event)) {
            consumerOutputEmitted = true;
          }

          if (event.kind === "COMPLETED") {
            this.notifyProviderAttempt(options, {
              modelProfileVersionId: candidateId,
              outcome: "SUCCEEDED",
              osvaResponseCacheHit: false,
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
              estimatedCostUsdMicros: candidateCost.estimatedCostUsdMicros,
            });

            await this.persistRoutingDecision({
              decision: {
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
                estimatedCost: candidateCost,
                attempts,
                runId: options?.routing?.runId,
                finalOutcome: "SUCCEEDED",
              },
            });

            forwardedToConsumer = true;
            yield event;
            return;
          }

          forwardedToConsumer = true;
          yield event;

          if (event.kind === "FAILED") {
            const failure = modelStreamFailedEventToError(event);
            this.notifyProviderAttempt(options, {
              modelProfileVersionId: candidateId,
              outcome: "FAILED",
              osvaResponseCacheHit: false,
            });
            const failureConnectionVersionId =
              await this.resolveConnectionVersionId(candidateId);
            const retryable =
              failure.retryable === true
                ? true
                : isRetryableRoutingFallback(failure);
            this.deps.circuitBreaker?.observe({
              workspaceId: routing.workspaceId,
              modelProfileVersionId: candidateId,
              connectionVersionId: failureConnectionVersionId,
              success: false,
              retryable,
              atMs: this.deps.now?.() ?? Date.now(),
            });
            const latencyMs = (this.deps.now?.() ?? Date.now()) - started;
            attempts.push({
              modelProfileVersionId: candidateId,
              outcome: "FAILED",
              completionLatencyMs: latencyMs,
              failureCode: failure.code,
              retryable,
              estimatedCostUsdMicros: candidateCost.estimatedCostUsdMicros,
            });
            await this.persistRoutingDecision({
              decision: {
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
                estimatedCost: candidateCost,
                attempts,
                runId: options?.routing?.runId,
                finalOutcome: "FAILED",
              },
            });
            throw failure;
          }
        }

        return;
      } catch (error) {
        if (
          consumerOutputEmitted ||
          forwardedToConsumer ||
          providerEventsSeen > 0
        ) {
          throw error;
        }
        lastError = error;
        this.notifyProviderAttempt(options, {
          modelProfileVersionId: candidateId,
          outcome: "FAILED",
          osvaResponseCacheHit: false,
        });
        if (isNonFallbackRoutingError(error)) {
          attempts.push({
            modelProfileVersionId: candidateId,
            outcome: "FAILED",
            failureCode: isModelGatewayError(error) ? error.code : undefined,
            retryable: false,
            estimatedCostUsdMicros: candidateCost.estimatedCostUsdMicros,
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
              estimatedCost: candidateCost,
              attempts,
              runId: options?.routing?.runId,
              finalOutcome: "FAILED",
            },
          });
          throw error;
        }

        const retryable = isStreamingPreOutputFallbackEligible(error);
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
          estimatedCostUsdMicros: candidateCost.estimatedCostUsdMicros,
        });

        if (!allowFallback || !retryable) {
          break attemptLoop;
        }
      }
    }

    const primaryCost = await this.estimateCandidatePreflightCost(
      request,
      selection.primary.modelProfileVersionId,
    );
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
      estimatedCost: primaryCost,
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
      (routed, attemptOptions) =>
        this.deps.inner.generateTextOutcome(
          routed as GenerateTextRequest,
          attemptOptions,
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
      (routed, attemptOptions) =>
        this.deps.inner.generateCompletionOutcome(routed, attemptOptions),
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
      attemptOptions?: ModelGatewayGenerateTextOptions,
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
      const candidateCost = await this.estimateCandidatePreflightCost(
        request,
        candidateId,
      );
      try {
        const attemptOptions = mergeProviderAttemptBudgetOptions(options, {
          providerAttemptIndex: index,
          selectedModelProfileVersionId: candidateId,
        });
        const outcome = await invoke(
          {
            ...request,
            modelProfileVersionId: candidateId,
          },
          attemptOptions,
        );

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
          estimatedCostUsdMicros: candidateCost.estimatedCostUsdMicros,
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
          estimatedCost: candidateCost,
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
        const { retryable, nonFallback } = classifyRoutingAttemptFailure(error);
        if (nonFallback) {
          attempts.push({
            modelProfileVersionId: candidateId,
            outcome: "FAILED",
            failureCode: isModelGatewayError(error) ? error.code : undefined,
            retryable: false,
            estimatedCostUsdMicros: candidateCost.estimatedCostUsdMicros,
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
              estimatedCost: candidateCost,
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
          estimatedCostUsdMicros: candidateCost.estimatedCostUsdMicros,
        });

        if (!allowFallback || !retryable) {
          break;
        }
      }
    }

    const primaryCost = await this.estimateCandidatePreflightCost(
      request,
      selection.primary.modelProfileVersionId,
    );
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
      estimatedCost: primaryCost,
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

  private async estimateCandidatePreflightCost(
    request: GenerateTextRequest | GenerateCompletionRequest,
    candidateId: ModelProfileVersionId,
  ): Promise<InferenceRoutingCostEstimate> {
    const version =
      await this.deps.modelProfiles.findModelProfileVersionById(candidateId);
    const inputTokens = estimateRoutingInputTokens(request.messages);
    return estimateRoutingPreflightCostUsdMicros({
      estimatedInputTokens: inputTokens,
      maxOutputTokens: request.maxOutputTokens,
      pricing: version?.pricing,
    });
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

function isConsumerVisibleStreamOutput(event: ModelStreamEvent): boolean {
  switch (event.kind) {
    case "TEXT_DELTA":
      return event.textDelta.length > 0;
    case "TOOL_CALL_START":
    case "TOOL_CALL_ARGUMENTS_DELTA":
    case "TOOL_CALL_COMPLETE":
      return true;
    default:
      return false;
  }
}

function modelStreamFailedEventToError(
  event: Extract<ModelStreamEvent, { kind: "FAILED" }>,
): ModelGatewayError {
  return new ModelGatewayError(event.code, event.message, {
    retryable: event.retryable,
  });
}

function classifyRoutingAttemptFailure(error: unknown): {
  readonly retryable: boolean;
  readonly nonFallback: boolean;
} {
  if (isNonFallbackRoutingError(error)) {
    return { retryable: false, nonFallback: true };
  }
  const retryable =
    isModelGatewayError(error) && error.retryable === true
      ? true
      : isRetryableRoutingFallback(error);
  return { retryable, nonFallback: false };
}

function isStreamingPreOutputFallbackEligible(error: unknown): boolean {
  if (isNonFallbackRoutingError(error)) {
    return false;
  }
  if (isModelGatewayError(error)) {
    return (
      error.code === MODEL_ERROR_CODES.MODEL_RATE_LIMITED ||
      error.code === MODEL_ERROR_CODES.MODEL_REQUEST_TIMEOUT ||
      error.code === MODEL_ERROR_CODES.MODEL_PROVIDER_UNAVAILABLE
    );
  }
  return false;
}
