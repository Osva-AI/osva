import { randomUUID } from "node:crypto";

import type {
  ExecutionRequest,
  GenerateCompletionRequest,
  GenerateCompletionResult,
  GenerateTextRequest,
  GenerateTextResult,
  JsonValue,
  ModelStreamEvent,
  ModelStreamEventSource,
  KnowledgeHitV1,
  KnowledgeSearchRequestV1,
  MemoryAuthorization,
  MemoryDeleteRequest,
  MemoryGetRequest,
  MemoryListRequest,
  MemoryListResult,
  MemoryRecordView,
  MemorySetRequest,
  RunStepId,
  ToolInvokeRequest,
} from "@osva-ai/contracts";
import {
  KNOWLEDGE_ERROR_CODES,
  MEMORY_ERROR_CODES,
  MODEL_ERROR_CODES,
  RUN_LIVE_STREAM_VIEWER_FORMAT_VERSION,
  TOOL_ERROR_CODES,
  isModelStreamTerminalKind,
  projectModelStreamEventToViewer,
} from "@osva-ai/contracts";
import type {
  RunLiveStreamPublisher,
  RunLiveStreamViewerProjectionPolicy,
} from "@osva-ai/contracts";
import { DEFAULT_RUN_LIVE_STREAM_VIEWER_POLICY } from "@osva-ai/contracts";
import type { MemoryGateway } from "@osva-ai/contracts";
import {
  RunStep,
  type FinalizeRunStepProps,
  type ModelProfileRepository,
  type RunRepository,
} from "@osva/domain";
import type {
  ModelGatewayBudgetContext,
  ModelGatewayGenerateTextOptions,
  ProviderGenerateTextResult,
} from "@osva/model-gateway";

import {
  isOsvaResponseCacheHitOutcome,
  resolveModelGatewayGenerateOptions,
} from "./model-gateway-cache-context.js";
import {
  type InferenceBudgetOrdinalAllocator,
  resolveModelGatewayBudgetContextAsync,
} from "./model-gateway-budget-context.js";
import type {
  InferenceBudgetAdmissionPort,
  InferenceBudgetInvocationOrdinalPort,
} from "@osva-ai/contracts";
import {
  attachRoutingProviderAttemptTelemetry,
  shouldRecordFinalProviderMetrics,
} from "./routing-provider-attempt-telemetry.js";
import { buildModelRunStepFinalizeProps } from "./model-run-step-finalize.js";
import { providerOutcomeFromModelStream } from "./model-stream-outcome.js";
import type { ToolGateway } from "@osva/tool-gateway";

import { OSVA_ATTR } from "./attributes.js";
import {
  elapsedMs,
  resolveInstrumentation,
  type OsvaInstrumentation,
} from "./instrumentation.js";
import { OSVA_METRIC } from "./metrics.js";
import { OSVA_SPAN } from "./span-names.js";

export interface RunStepRecorderLogger {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, error: unknown): void;
}

export interface RunStepRecorderClock {
  now(): Date;
}

export interface RunStepRecorderIds {
  createId(): string;
}

export interface RunStepRecorderDependencies {
  readonly runs: RunRepository;
  readonly modelProfiles: ModelProfileRepository;
  readonly clock: RunStepRecorderClock;
  readonly ids: RunStepRecorderIds;
  readonly logger?: RunStepRecorderLogger;
  readonly instrumentation?: OsvaInstrumentation;
  /** Optional ephemeral viewer fan-out; must not affect model execution. */
  readonly runLiveStream?: RunLiveStreamPublisher;
  readonly runLiveStreamPolicy?: RunLiveStreamViewerProjectionPolicy;
  readonly inferenceBudgetAdmission?: InferenceBudgetAdmissionPort;
  readonly inferenceBudgetOrdinals?: InferenceBudgetOrdinalAllocator;
  readonly inferenceBudgetOrdinalPort?: InferenceBudgetInvocationOrdinalPort;
  readonly resolveTrustedWorkspaceInferenceBudgetPolicy?: import("./model-gateway-budget-context.js").TrustedWorkspaceInferenceBudgetPolicyResolver;
}

export interface RuntimeMemoryGateway {
  get(
    request: MemoryGetRequest,
    authorization: MemoryAuthorization,
  ): Promise<MemoryRecordView>;
  set(
    request: MemorySetRequest,
    authorization: MemoryAuthorization,
  ): Promise<MemoryRecordView>;
  delete(
    request: MemoryDeleteRequest,
    authorization: MemoryAuthorization,
  ): Promise<void>;
  list(
    request: MemoryListRequest,
    authorization: MemoryAuthorization,
  ): Promise<MemoryListResult>;
}

export interface RuntimeKnowledgeGateway {
  search(
    bindingName: string,
    request: KnowledgeSearchRequestV1,
  ): Promise<readonly KnowledgeHitV1[]>;
}

export interface KnowledgeGatewayDelegate {
  search(
    execution: ExecutionRequest,
    bindingName: string,
    request: KnowledgeSearchRequestV1,
  ): Promise<readonly KnowledgeHitV1[]>;
}

export interface ScopedRunStepRecorder {
  wrapModelGateway(modelGateway: RecorderModelGateway): RuntimeModelGateway;
  wrapToolGateway(toolGateway: ToolGateway): RuntimeToolGateway;
  wrapMemoryGateway(memoryGateway: MemoryGateway): RuntimeMemoryGateway;
  wrapKnowledgeGateway(
    knowledgeGateway: KnowledgeGatewayDelegate,
  ): RuntimeKnowledgeGateway;
}

/**
 * Parent-process execution observability seam. Records RunSteps without
 * exposing persistence to the trusted runtime child.
 */
/** Model gateway surface required by RunStep recording (includes outcome helpers). */
export interface RecorderModelGateway {
  generateTextOutcome(
    request: GenerateTextRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): Promise<ProviderGenerateTextResult>;
  generateCompletionOutcome(
    request: GenerateCompletionRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): Promise<ProviderGenerateTextResult>;
  generateCompletionStream(
    request: GenerateCompletionRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): ModelStreamEventSource;
}

export interface RuntimeModelGateway {
  generateText(
    request: GenerateTextRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GenerateTextResult>;
  generateCompletion(
    request: GenerateCompletionRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GenerateCompletionResult>;
  generateCompletionStream(
    request: GenerateCompletionRequest,
    options?: { readonly signal?: AbortSignal },
  ): ModelStreamEventSource;
}

export interface RuntimeToolGateway {
  invoke(request: ToolInvokeRequest): Promise<JsonValue>;
}

export function createRunStepRecorder(
  execution: ExecutionRequest,
  deps: RunStepRecorderDependencies,
): ScopedRunStepRecorder {
  return {
    wrapModelGateway(modelGateway) {
      return new ObservabilityModelGateway(execution, deps, modelGateway);
    },
    wrapToolGateway(toolGateway) {
      return new ObservabilityToolGateway(execution, deps, toolGateway);
    },
    wrapMemoryGateway(memoryGateway) {
      return new ObservabilityMemoryGateway(execution, deps, memoryGateway);
    },
    wrapKnowledgeGateway(knowledgeGateway) {
      return new ObservabilityKnowledgeGateway(
        execution,
        deps,
        knowledgeGateway,
      );
    },
  };
}

class ObservabilityModelGateway implements RuntimeModelGateway {
  private liveStreamReceivingHintPublished = false;

  constructor(
    private readonly execution: ExecutionRequest,
    private readonly deps: RunStepRecorderDependencies,
    private readonly inner: RecorderModelGateway,
  ) {}

  async generateText(
    request: GenerateTextRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GenerateTextResult> {
    const telemetry = resolveInstrumentation(this.deps.instrumentation);
    const bindingName = findModelBindingName(
      this.execution.modelProfileVersionBindings,
      request.modelProfileVersionId,
    );
    const startedAt = this.deps.clock.now();
    const perfStartedAt = performance.now();
    const runStepId = this.deps.ids.createId() as RunStepId;

    const running = RunStep.start({
      id: runStepId,
      runId: this.execution.runId,
      runAttemptId: this.execution.runAttemptId,
      kind: "MODEL",
      bindingName,
      startedAt,
      modelProfileVersionId: request.modelProfileVersionId,
    });

    try {
      await this.deps.runs.insertRunningRunStep(running);
    } catch (error) {
      this.deps.logger?.error("observability.run_step_start_failed", error);
    }

    this.deps.logger?.info("observability.model_step_started", {
      runId: this.execution.runId,
      runAttemptId: this.execution.runAttemptId,
      runStepId,
      kind: "MODEL",
      bindingName,
    });

    return telemetry.withSpan(
      OSVA_SPAN.MODEL_GENERATE_TEXT,
      {
        [OSVA_ATTR.RUN_ID]: this.execution.runId,
        [OSVA_ATTR.RUN_ATTEMPT_ID]: this.execution.runAttemptId,
        [OSVA_ATTR.MODEL_PROFILE_VERSION_ID]: request.modelProfileVersionId,
        [OSVA_ATTR.OPERATION]: "generate_text",
      },
      async (span) => {
        let outcome: ProviderGenerateTextResult | undefined;
        let version: Awaited<
          ReturnType<ModelProfileRepository["findModelProfileVersionById"]>
        > = null;
        let runStepFinalized = false;
        const budget = await resolveModelGatewayBudgetContextAsync({
          execution: this.execution,
          admission: this.deps.inferenceBudgetAdmission,
          bindingName,
          modelProfileVersionId: request.modelProfileVersionId,
          runStepId,
          invocationKind: "SYNC",
          ordinals: this.deps.inferenceBudgetOrdinals,
          ordinalPort: this.deps.inferenceBudgetOrdinalPort,
          resolveTrustedWorkspacePolicy:
            this.deps.resolveTrustedWorkspaceInferenceBudgetPolicy,
        });
        const baseGenerateOptions = resolveModelGatewayGenerateOptions(
          this.execution,
          {
            ...options,
            boundModelProfileVersionId: request.modelProfileVersionId,
            budget,
          },
        );
        const attemptTelemetry = attachRoutingProviderAttemptTelemetry(
          this.deps,
          baseGenerateOptions,
          "unknown",
        );

        try {
          outcome = await this.inner.generateTextOutcome(
            request,
            attemptTelemetry.options,
          );
          version = await this.deps.modelProfiles.findModelProfileVersionById(
            request.modelProfileVersionId,
          );
          if (version !== null) {
            span.setAttributes({
              [OSVA_ATTR.PROVIDER]: version.provider,
            });
          }

          if (outcome.text === undefined || outcome.text.trim().length === 0) {
            const errorCode = MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE;
            await this.finalizeModelRunStep(runStepId, {
              outcome,
              version,
              status: "FAILED",
              errorCode,
            });
            runStepFinalized = true;
            span.setStatus(false, errorCode);
            throw new Error(errorCode);
          }

          await this.finalizeModelRunStep(runStepId, {
            outcome,
            version,
            status: "SUCCEEDED",
          });
          runStepFinalized = true;

          span.setStatus(true);
          const cacheHit = isOsvaResponseCacheHitOutcome(outcome);
          const providerName = version?.provider ?? "unknown";
          telemetry.recordHistogram(
            OSVA_METRIC.MODEL_DURATION_MS,
            elapsedMs(perfStartedAt, performance.now()),
            { provider: providerName },
          );
          if (
            shouldRecordFinalProviderMetrics({
              cacheHit,
              routingEnabled:
                baseGenerateOptions?.routing?.policy.enabled === true,
              routingProviderInvocations:
                attemptTelemetry.providerInvocationCount,
            })
          ) {
            telemetry.recordCounter(OSVA_METRIC.MODEL_CALLS, 1, {
              provider: providerName,
            });
            if (outcome.usage !== undefined) {
              telemetry.recordHistogram(
                OSVA_METRIC.MODEL_INPUT_TOKENS,
                outcome.usage.inputTokens,
                { provider: providerName },
              );
              telemetry.recordHistogram(
                OSVA_METRIC.MODEL_OUTPUT_TOKENS,
                outcome.usage.outputTokens,
                { provider: providerName },
              );
            }
          } else if (!cacheHit && outcome.usage !== undefined) {
            telemetry.recordHistogram(
              OSVA_METRIC.MODEL_INPUT_TOKENS,
              outcome.usage.inputTokens,
              { provider: providerName },
            );
            telemetry.recordHistogram(
              OSVA_METRIC.MODEL_OUTPUT_TOKENS,
              outcome.usage.outputTokens,
              { provider: providerName },
            );
          }

          return { text: outcome.text };
        } catch (error) {
          const errorCategory = mapModelErrorCode(error);
          if (!runStepFinalized) {
            if (outcome !== undefined) {
              await this.finalizeModelRunStep(runStepId, {
                outcome,
                version,
                status: "FAILED",
                errorCode: errorCategory,
              });
            } else {
              await this.finalizeSafely(runStepId, {
                status: "FAILED",
                completedAt: this.deps.clock.now(),
                errorCode: errorCategory,
              });
            }
          }
          span.setStatus(false, errorCategory);
          span.recordException(error);
          throw error;
        }
      },
    );
  }

  generateCompletionStream(
    request: GenerateCompletionRequest,
    options?: { readonly signal?: AbortSignal },
  ): ModelStreamEventSource {
    const telemetry = resolveInstrumentation(this.deps.instrumentation);
    const bindingName = findModelBindingName(
      this.execution.modelProfileVersionBindings,
      request.modelProfileVersionId,
    );
    const startedAt = this.deps.clock.now();
    const perfStartedAt = performance.now();
    const runStepId = this.deps.ids.createId() as RunStepId;
    this.liveStreamReceivingHintPublished = false;

    const running = RunStep.start({
      id: runStepId,
      runId: this.execution.runId,
      runAttemptId: this.execution.runAttemptId,
      kind: "MODEL",
      bindingName,
      startedAt,
      modelProfileVersionId: request.modelProfileVersionId,
    });

    void this.deps.runs.insertRunningRunStep(running).catch((error) => {
      this.deps.logger?.error("observability.run_step_start_failed", error);
    });

    this.deps.logger?.info("observability.model_step_started", {
      runId: this.execution.runId,
      runAttemptId: this.execution.runAttemptId,
      runStepId,
      kind: "MODEL",
      bindingName,
    });

    const budgetPromise = resolveModelGatewayBudgetContextAsync({
      execution: this.execution,
      admission: this.deps.inferenceBudgetAdmission,
      bindingName,
      modelProfileVersionId: request.modelProfileVersionId,
      runStepId,
      invocationKind: "STREAM",
      ordinals: this.deps.inferenceBudgetOrdinals,
      ordinalPort: this.deps.inferenceBudgetOrdinalPort,
      resolveTrustedWorkspacePolicy:
        this.deps.resolveTrustedWorkspaceInferenceBudgetPolicy,
    });

    return this.recordedModelCompletionStream({
      request,
      budgetPromise,
      signal: options?.signal,
      runStepId,
      perfStartedAt,
      telemetry,
    });
  }

  private tryPublishLiveViewerEvent(event: ModelStreamEvent): void {
    const publisher = this.deps.runLiveStream;
    if (publisher === undefined) {
      return;
    }

    const policy =
      this.deps.runLiveStreamPolicy ?? DEFAULT_RUN_LIVE_STREAM_VIEWER_POLICY;
    const viewerEvent = projectModelStreamEventToViewer(event, policy);
    if (viewerEvent === undefined) {
      return;
    }

    if (
      viewerEvent.kind === "STREAM_STATUS" &&
      viewerEvent.status === "receiving"
    ) {
      if (this.liveStreamReceivingHintPublished) {
        return;
      }
      this.liveStreamReceivingHintPublished = true;
    }

    publisher.tryPublish({
      formatVersion: RUN_LIVE_STREAM_VIEWER_FORMAT_VERSION,
      workspaceId: this.execution.workspaceId,
      runId: this.execution.runId,
      runAttemptId: this.execution.runAttemptId,
      streamId: event.streamId,
      sequence: event.sequence,
      emittedAt: this.deps.clock.now().toISOString(),
      viewerEvent,
    });
  }

  private async *recordedModelCompletionStream(options: {
    readonly request: GenerateCompletionRequest;
    readonly budgetPromise: Promise<ModelGatewayBudgetContext | undefined>;
    readonly signal: AbortSignal | undefined;
    readonly runStepId: RunStepId;
    readonly perfStartedAt: number;
    readonly telemetry: ReturnType<typeof resolveInstrumentation>;
  }): AsyncGenerator<ModelStreamEvent> {
    const budget = await options.budgetPromise;
    const inner = this.inner.generateCompletionStream(
      options.request,
      resolveModelGatewayGenerateOptions(this.execution, {
        signal: options.signal,
        boundModelProfileVersionId: options.request.modelProfileVersionId,
        budget,
      }),
    );
    const events: ModelStreamEvent[] = [];
    let version: Awaited<
      ReturnType<ModelProfileRepository["findModelProfileVersionById"]>
    > = null;
    let finalized = false;

    const finalizeFromEvents = async (): Promise<void> => {
      if (finalized || events.length === 0) {
        return;
      }

      version = await this.deps.modelProfiles.findModelProfileVersionById(
        options.request.modelProfileVersionId,
      );
      const verdict = providerOutcomeFromModelStream(events);
      if (verdict.status === "SUCCEEDED") {
        await this.finalizeModelRunStep(options.runStepId, {
          outcome: verdict.outcome,
          version,
          status: "SUCCEEDED",
        });
        finalized = true;
        options.telemetry.recordCounter(OSVA_METRIC.MODEL_CALLS, 1, {
          provider: version?.provider ?? "unknown",
        });
        options.telemetry.recordHistogram(
          OSVA_METRIC.MODEL_DURATION_MS,
          elapsedMs(options.perfStartedAt, performance.now()),
          { provider: version?.provider ?? "unknown" },
        );
        if (verdict.outcome.usage !== undefined) {
          options.telemetry.recordHistogram(
            OSVA_METRIC.MODEL_INPUT_TOKENS,
            verdict.outcome.usage.inputTokens,
            { provider: version?.provider ?? "unknown" },
          );
          options.telemetry.recordHistogram(
            OSVA_METRIC.MODEL_OUTPUT_TOKENS,
            verdict.outcome.usage.outputTokens,
            { provider: version?.provider ?? "unknown" },
          );
        }
      } else {
        await this.finalizeModelRunStep(options.runStepId, {
          outcome: verdict.outcome,
          version,
          status: "FAILED",
          errorCode: verdict.errorCode,
        });
        finalized = true;
      }
    };

    try {
      for await (const event of inner) {
        events.push(event);
        this.tryPublishLiveViewerEvent(event);
        yield event;
        if (isModelStreamTerminalKind(event.kind)) {
          break;
        }
      }
    } catch (error) {
      const errorCategory = mapModelErrorCode(error);
      if (!finalized) {
        if (events.length > 0) {
          const verdict = providerOutcomeFromModelStream(events);
          await this.finalizeModelRunStep(options.runStepId, {
            outcome: verdict.outcome,
            version,
            status: "FAILED",
            errorCode:
              verdict.status === "FAILED"
                ? (verdict.errorCode ?? errorCategory)
                : errorCategory,
          });
          finalized = true;
        } else {
          await this.finalizeSafely(options.runStepId, {
            status: "FAILED",
            completedAt: this.deps.clock.now(),
            errorCode: errorCategory,
          });
          finalized = true;
        }
      }
      throw error;
    } finally {
      await finalizeFromEvents();
    }
  }

  async generateCompletion(
    request: GenerateCompletionRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GenerateCompletionResult> {
    const telemetry = resolveInstrumentation(this.deps.instrumentation);
    const bindingName = findModelBindingName(
      this.execution.modelProfileVersionBindings,
      request.modelProfileVersionId,
    );
    const startedAt = this.deps.clock.now();
    const perfStartedAt = performance.now();
    const runStepId = this.deps.ids.createId() as RunStepId;

    const running = RunStep.start({
      id: runStepId,
      runId: this.execution.runId,
      runAttemptId: this.execution.runAttemptId,
      kind: "MODEL",
      bindingName,
      startedAt,
      modelProfileVersionId: request.modelProfileVersionId,
    });

    try {
      await this.deps.runs.insertRunningRunStep(running);
    } catch (error) {
      this.deps.logger?.error("observability.run_step_start_failed", error);
    }

    this.deps.logger?.info("observability.model_step_started", {
      runId: this.execution.runId,
      runAttemptId: this.execution.runAttemptId,
      runStepId,
      kind: "MODEL",
      bindingName,
    });

    return telemetry.withSpan(
      OSVA_SPAN.MODEL_GENERATE_TEXT,
      {
        [OSVA_ATTR.RUN_ID]: this.execution.runId,
        [OSVA_ATTR.RUN_ATTEMPT_ID]: this.execution.runAttemptId,
        [OSVA_ATTR.MODEL_PROFILE_VERSION_ID]: request.modelProfileVersionId,
        [OSVA_ATTR.OPERATION]: "generate_completion",
      },
      async (span) => {
        let outcome: ProviderGenerateTextResult | undefined;
        let version: Awaited<
          ReturnType<ModelProfileRepository["findModelProfileVersionById"]>
        > = null;
        let runStepFinalized = false;

        const budget = await resolveModelGatewayBudgetContextAsync({
          execution: this.execution,
          admission: this.deps.inferenceBudgetAdmission,
          bindingName,
          modelProfileVersionId: request.modelProfileVersionId,
          runStepId,
          invocationKind: "SYNC",
          ordinals: this.deps.inferenceBudgetOrdinals,
          ordinalPort: this.deps.inferenceBudgetOrdinalPort,
          resolveTrustedWorkspacePolicy:
            this.deps.resolveTrustedWorkspaceInferenceBudgetPolicy,
        });
        try {
          outcome = await this.inner.generateCompletionOutcome(
            request,
            resolveModelGatewayGenerateOptions(this.execution, {
              ...options,
              boundModelProfileVersionId: request.modelProfileVersionId,
              budget,
            }),
          );
          version = await this.deps.modelProfiles.findModelProfileVersionById(
            request.modelProfileVersionId,
          );
          if (version !== null) {
            span.setAttributes({
              [OSVA_ATTR.PROVIDER]: version.provider,
            });
          }

          await this.finalizeModelRunStep(runStepId, {
            outcome,
            version,
            status: "SUCCEEDED",
          });
          runStepFinalized = true;

          span.setStatus(true);
          telemetry.recordCounter(OSVA_METRIC.MODEL_CALLS, 1, {
            provider: version?.provider ?? "unknown",
          });
          telemetry.recordHistogram(
            OSVA_METRIC.MODEL_DURATION_MS,
            elapsedMs(perfStartedAt, performance.now()),
            { provider: version?.provider ?? "unknown" },
          );
          if (outcome.usage !== undefined) {
            telemetry.recordHistogram(
              OSVA_METRIC.MODEL_INPUT_TOKENS,
              outcome.usage.inputTokens,
              { provider: version?.provider ?? "unknown" },
            );
            telemetry.recordHistogram(
              OSVA_METRIC.MODEL_OUTPUT_TOKENS,
              outcome.usage.outputTokens,
              { provider: version?.provider ?? "unknown" },
            );
          }

          return {
            text: outcome.text,
            toolCalls: outcome.toolCalls ?? [],
            finishReason: outcome.finishReason ?? "other",
          };
        } catch (error) {
          const errorCategory = mapModelErrorCode(error);
          if (!runStepFinalized) {
            if (outcome !== undefined) {
              await this.finalizeModelRunStep(runStepId, {
                outcome,
                version,
                status: "FAILED",
                errorCode: errorCategory,
              });
            } else {
              await this.finalizeSafely(runStepId, {
                status: "FAILED",
                completedAt: this.deps.clock.now(),
                errorCode: errorCategory,
              });
            }
          }
          span.setStatus(false, errorCategory);
          span.recordException(error);
          throw error;
        }
      },
    );
  }

  private async finalizeModelRunStep(
    runStepId: RunStepId,
    input: {
      readonly outcome: ProviderGenerateTextResult | undefined;
      readonly version: Awaited<
        ReturnType<ModelProfileRepository["findModelProfileVersionById"]>
      >;
      readonly status: "SUCCEEDED" | "FAILED";
      readonly errorCode?: string;
    },
  ): Promise<void> {
    const finalize: FinalizeRunStepProps = buildModelRunStepFinalizeProps({
      outcome: input.outcome,
      version: input.version,
      status: input.status,
      completedAt: this.deps.clock.now(),
      errorCode: input.errorCode,
    });
    await this.finalizeSafely(runStepId, finalize);
  }

  private async finalizeSafely(
    runStepId: RunStepId,
    finalize: Parameters<RunStep["finalize"]>[0],
  ): Promise<void> {
    try {
      await this.deps.runs.finalizeRunStep(runStepId, finalize);
      this.deps.logger?.info("observability.model_step_finalized", {
        runId: this.execution.runId,
        runAttemptId: this.execution.runAttemptId,
        runStepId,
        status: finalize.status,
      });
    } catch (error) {
      this.deps.logger?.error("observability.run_step_finalize_failed", error);
    }
  }
}

class ObservabilityToolGateway implements RuntimeToolGateway {
  constructor(
    private readonly execution: ExecutionRequest,
    private readonly deps: RunStepRecorderDependencies,
    private readonly inner: ToolGateway,
  ) {}

  async invoke(request: ToolInvokeRequest): Promise<JsonValue> {
    const telemetry = resolveInstrumentation(this.deps.instrumentation);
    const startedAt = this.deps.clock.now();
    const perfStartedAt = performance.now();
    const runStepId = this.deps.ids.createId() as RunStepId;

    const running = RunStep.start({
      id: runStepId,
      runId: this.execution.runId,
      runAttemptId: this.execution.runAttemptId,
      kind: "TOOL",
      bindingName: request.authorization.bindingName,
      startedAt,
      toolVersionId: request.toolVersionId,
    });

    try {
      await this.deps.runs.insertRunningRunStep(running);
    } catch (error) {
      this.deps.logger?.error("observability.run_step_start_failed", error);
    }

    this.deps.logger?.info("observability.tool_step_started", {
      runId: this.execution.runId,
      runAttemptId: this.execution.runAttemptId,
      runStepId,
      kind: "TOOL",
      bindingName: request.authorization.bindingName,
    });

    const executionKind = "gateway";

    return telemetry.withSpan(
      OSVA_SPAN.TOOL_INVOKE,
      {
        [OSVA_ATTR.RUN_ID]: this.execution.runId,
        [OSVA_ATTR.RUN_ATTEMPT_ID]: this.execution.runAttemptId,
        [OSVA_ATTR.TOOL_VERSION_ID]: request.toolVersionId,
        [OSVA_ATTR.OPERATION]: "invoke",
        [OSVA_ATTR.TOOL_EXECUTION_KIND]: executionKind,
      },
      async (span) => {
        try {
          const output = await this.inner.invoke(request);
          await this.finalizeSafely(runStepId, {
            status: "SUCCEEDED",
            completedAt: this.deps.clock.now(),
          });
          span.setStatus(true);
          telemetry.recordCounter(OSVA_METRIC.TOOL_CALLS, 1, {
            tool_execution_kind: executionKind,
          });
          telemetry.recordHistogram(
            OSVA_METRIC.TOOL_DURATION_MS,
            elapsedMs(perfStartedAt, performance.now()),
            { tool_execution_kind: executionKind },
          );
          return output;
        } catch (error) {
          const errorCategory = mapToolErrorCode(error);
          await this.finalizeSafely(runStepId, {
            status: "FAILED",
            completedAt: this.deps.clock.now(),
            errorCode: errorCategory,
          });
          span.setStatus(false, errorCategory);
          span.recordException(error);
          telemetry.recordCounter(OSVA_METRIC.TOOL_ERRORS, 1, {
            tool_execution_kind: executionKind,
            error_category: errorCategory,
          });
          throw error;
        }
      },
    );
  }

  private async finalizeSafely(
    runStepId: RunStepId,
    finalize: Parameters<RunStep["finalize"]>[0],
  ): Promise<void> {
    try {
      await this.deps.runs.finalizeRunStep(runStepId, finalize);
      this.deps.logger?.info("observability.tool_step_finalized", {
        runId: this.execution.runId,
        runAttemptId: this.execution.runAttemptId,
        runStepId,
        status: finalize.status,
      });
    } catch (error) {
      this.deps.logger?.error("observability.run_step_finalize_failed", error);
    }
  }
}

function findModelBindingName(
  bindings: ExecutionRequest["modelProfileVersionBindings"],
  modelProfileVersionId: GenerateTextRequest["modelProfileVersionId"],
): string {
  for (const [bindingName, versionId] of Object.entries(bindings)) {
    if (versionId === modelProfileVersionId) {
      return bindingName;
    }
  }

  return "unknown";
}

function mapModelErrorCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    return error.code;
  }

  return MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR;
}

class ObservabilityMemoryGateway implements RuntimeMemoryGateway {
  constructor(
    private readonly execution: ExecutionRequest,
    private readonly deps: RunStepRecorderDependencies,
    private readonly inner: MemoryGateway,
  ) {}

  async get(
    request: MemoryGetRequest,
    authorization: MemoryAuthorization,
  ): Promise<MemoryRecordView> {
    return this.record("memory.get", request.bindingName, () =>
      this.inner.get(request, authorization),
    );
  }

  async set(
    request: MemorySetRequest,
    authorization: MemoryAuthorization,
  ): Promise<MemoryRecordView> {
    return this.record("memory.set", request.bindingName, () =>
      this.inner.set(request, authorization),
    );
  }

  async delete(
    request: MemoryDeleteRequest,
    authorization: MemoryAuthorization,
  ): Promise<void> {
    await this.record("memory.delete", request.bindingName, () =>
      this.inner.delete(request, authorization),
    );
  }

  async list(
    request: MemoryListRequest,
    authorization: MemoryAuthorization,
  ): Promise<MemoryListResult> {
    return this.record("memory.list", request.bindingName, () =>
      this.inner.list(request, authorization),
    );
  }

  private async record<T>(
    operation: string,
    bindingName: string,
    invoke: () => Promise<T>,
  ): Promise<T> {
    const telemetry = resolveInstrumentation(this.deps.instrumentation);
    const startedAt = this.deps.clock.now();
    const runStepId = this.deps.ids.createId() as RunStepId;
    const memoryOperation = operation.replace(/^memory\./, "");

    const running = RunStep.start({
      id: runStepId,
      runId: this.execution.runId,
      runAttemptId: this.execution.runAttemptId,
      kind: "MEMORY",
      bindingName,
      startedAt,
    });

    try {
      await this.deps.runs.insertRunningRunStep(running);
    } catch (error) {
      this.deps.logger?.error("observability.run_step_start_failed", error);
    }

    this.deps.logger?.info("observability.memory_step_started", {
      runId: this.execution.runId,
      runAttemptId: this.execution.runAttemptId,
      runStepId,
      kind: "MEMORY",
      bindingName,
      operation,
    });

    return telemetry.withSpan(
      OSVA_SPAN.MEMORY_OPERATION,
      {
        [OSVA_ATTR.RUN_ID]: this.execution.runId,
        [OSVA_ATTR.RUN_ATTEMPT_ID]: this.execution.runAttemptId,
        [OSVA_ATTR.OPERATION]: memoryOperation,
      },
      async (span) => {
        try {
          const result = await invoke();
          await this.finalizeSafely(runStepId, {
            status: "SUCCEEDED",
            completedAt: this.deps.clock.now(),
          });
          span.setStatus(true);
          telemetry.recordCounter(OSVA_METRIC.MEMORY_OPERATIONS, 1, {
            operation: memoryOperation,
          });
          return result;
        } catch (error) {
          const errorCategory = mapMemoryErrorCode(error);
          await this.finalizeSafely(runStepId, {
            status: "FAILED",
            completedAt: this.deps.clock.now(),
            errorCode: errorCategory,
          });
          span.setStatus(false, errorCategory);
          span.recordException(error);
          throw error;
        }
      },
    );
  }

  private async finalizeSafely(
    runStepId: RunStepId,
    finalize: Parameters<RunStep["finalize"]>[0],
  ): Promise<void> {
    try {
      await this.deps.runs.finalizeRunStep(runStepId, finalize);
      this.deps.logger?.info("observability.memory_step_finalized", {
        runId: this.execution.runId,
        runAttemptId: this.execution.runAttemptId,
        runStepId,
        status: finalize.status,
      });
    } catch (error) {
      this.deps.logger?.error("observability.run_step_finalize_failed", error);
    }
  }
}

function mapMemoryErrorCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    return error.code;
  }

  return MEMORY_ERROR_CODES.MEMORY_UNAVAILABLE;
}

class ObservabilityKnowledgeGateway implements RuntimeKnowledgeGateway {
  constructor(
    private readonly execution: ExecutionRequest,
    private readonly deps: RunStepRecorderDependencies,
    private readonly inner: KnowledgeGatewayDelegate,
  ) {}

  async search(
    bindingName: string,
    request: KnowledgeSearchRequestV1,
  ): Promise<readonly KnowledgeHitV1[]> {
    const telemetry = resolveInstrumentation(this.deps.instrumentation);
    const startedAt = this.deps.clock.now();
    const runStepId = this.deps.ids.createId() as RunStepId;
    const indexIds = this.execution.knowledgeIndexBindings[bindingName];
    const indexCount = indexIds?.length ?? 0;
    const topK = request.topK ?? 5;

    const running = RunStep.start({
      id: runStepId,
      runId: this.execution.runId,
      runAttemptId: this.execution.runAttemptId,
      kind: "KNOWLEDGE",
      bindingName,
      startedAt,
    });

    try {
      await this.deps.runs.insertRunningRunStep(running);
    } catch (error) {
      this.deps.logger?.error("observability.run_step_start_failed", error);
    }

    this.deps.logger?.info("observability.knowledge_step_started", {
      runId: this.execution.runId,
      runAttemptId: this.execution.runAttemptId,
      runStepId,
      kind: "KNOWLEDGE",
      bindingName,
    });

    return telemetry.withSpan(
      OSVA_SPAN.KNOWLEDGE_RETRIEVE,
      {
        [OSVA_ATTR.RUN_ID]: this.execution.runId,
        [OSVA_ATTR.RUN_ATTEMPT_ID]: this.execution.runAttemptId,
        [OSVA_ATTR.KNOWLEDGE_BINDING_NAME]: bindingName,
        [OSVA_ATTR.KNOWLEDGE_INDEX_COUNT]: indexCount,
        [OSVA_ATTR.KNOWLEDGE_TOP_K]: topK,
        [OSVA_ATTR.OPERATION]: "search",
      },
      async (span) => {
        try {
          const hits = await this.inner.search(
            this.execution,
            bindingName,
            request,
          );
          await this.finalizeSafely(runStepId, {
            status: "SUCCEEDED",
            completedAt: this.deps.clock.now(),
          });
          span.setAttributes({
            [OSVA_ATTR.KNOWLEDGE_RESULT_COUNT]: hits.length,
          });
          span.setStatus(true);
          telemetry.recordCounter(OSVA_METRIC.KNOWLEDGE_RETRIEVES, 1, {
            operation: "search",
          });
          return hits;
        } catch (error) {
          const errorCategory = mapKnowledgeErrorCode(error);
          await this.finalizeSafely(runStepId, {
            status: "FAILED",
            completedAt: this.deps.clock.now(),
            errorCode: errorCategory,
          });
          span.setStatus(false, errorCategory);
          span.recordException(error);
          throw error;
        }
      },
    );
  }

  private async finalizeSafely(
    runStepId: RunStepId,
    finalize: Parameters<RunStep["finalize"]>[0],
  ): Promise<void> {
    try {
      await this.deps.runs.finalizeRunStep(runStepId, finalize);
      this.deps.logger?.info("observability.knowledge_step_finalized", {
        runId: this.execution.runId,
        runAttemptId: this.execution.runAttemptId,
        runStepId,
        status: finalize.status,
      });
    } catch (error) {
      this.deps.logger?.error("observability.run_step_finalize_failed", error);
    }
  }
}

function mapKnowledgeErrorCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    return error.code;
  }

  return KNOWLEDGE_ERROR_CODES.KNOWLEDGE_UNAVAILABLE;
}

function mapToolErrorCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    return error.code;
  }

  return TOOL_ERROR_CODES.TOOL_EXECUTION_ERROR;
}

export function createRunStepRecorderIds(): RunStepRecorderIds {
  return {
    createId: () => randomUUID(),
  };
}
