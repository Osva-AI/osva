import type {
  GenerateCompletionRequest,
  GenerateCompletionResult,
  GenerateTextRequest,
  GenerateTextResult,
  InferenceBudgetAdmissionOutcomeV1,
  InferenceBudgetPeriodLedgerV1,
  InferenceBudgetReservationSnapshotV1,
  InferenceBudgetRuntimePolicyV1,
  ModelStreamEvent,
  ModelStreamEventSource,
} from "@osva-ai/contracts";
import {
  INFERENCE_MODEL_INVOCATION_SOURCES,
  MODEL_ERROR_CODES,
  estimateRoutingPreflightCostUsdMicros,
  estimateRoutingInputTokens,
  isModelFinishReason,
} from "@osva-ai/contracts";
import type { InferenceBudgetAdmissionPort } from "@osva-ai/contracts";
import type { ModelProfileRepository } from "@osva/domain";
import {
  assertInferenceBudgetWorkspaceScope,
  buildInferenceInvocationAnchorString,
  createEmptyInferenceBudgetPeriodLedger,
  deriveInferenceBudgetReservationKey,
  estimateModelCostUsdMicros,
  resolveInferenceBudgetAdmitCeilingUsdMicros,
  parseInferenceBudgetPeriodKey,
  resolveInferenceBudgetUtcPeriodIdentity,
} from "@osva/domain";

import { ModelGatewayError, isModelGatewayError } from "./errors.js";
import {
  isModelGatewayBudgetEnforced,
  isModelGatewayBudgetFailClosed,
  type TrustedModelGatewayBudgetBindingV1,
} from "./model-gateway-budget-context.js";
import type {
  ModelGatewayGenerateTextOptions,
  ModelGatewayInvokePort,
} from "./provider-adapter.js";
import type { ProviderGenerateTextResult } from "./usage.js";
import { providerOutcomeFromModelStreamEvents } from "./budget-stream-outcome.js";

export interface BudgetEnforcingModelGatewayDependencies {
  readonly inner: ModelGatewayInvokePort;
  readonly modelProfiles: ModelProfileRepository;
  readonly admission: InferenceBudgetAdmissionPort;
  readonly now?: () => Date;
}

interface ActiveBudgetAttemptV1 {
  readonly binding: TrustedModelGatewayBudgetBindingV1;
  readonly policyDefinition: NonNullable<
    InferenceBudgetRuntimePolicyV1["definition"]
  >;
  readonly reservation: InferenceBudgetReservationSnapshotV1;
  readonly periodLedger: InferenceBudgetPeriodLedgerV1;
  readonly providerInvocationAuthorized: boolean;
}

type PreparedBudgetAttemptV1 =
  | { readonly kind: "BYPASS" }
  | ({ readonly kind: "ACTIVE" } & ActiveBudgetAttemptV1);

export class BudgetEnforcingModelGateway implements ModelGatewayInvokePort {
  constructor(private readonly deps: BudgetEnforcingModelGatewayDependencies) {}

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
    if (isModelGatewayBudgetFailClosed(options?.budget)) {
      throw budgetUnavailableError(
        "Workspace inference budget enforcement is active but budget admission is unavailable.",
      );
    }
    if (!isModelGatewayBudgetEnforced(options?.budget)) {
      return this.deps.inner.generateCompletionStream(request, options);
    }

    return {
      [Symbol.asyncIterator]: () =>
        this.iterateBudgetedCompletionStream(request, options),
    };
  }

  async generateTextOutcome(
    request: GenerateTextRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): Promise<ProviderGenerateTextResult> {
    return this.executeWithBudget(request, options, (r, o) =>
      this.deps.inner.generateTextOutcome(r as GenerateTextRequest, o),
    );
  }

  async generateCompletionOutcome(
    request: GenerateCompletionRequest,
    options?: ModelGatewayGenerateTextOptions,
  ): Promise<ProviderGenerateTextResult> {
    return this.executeWithBudget(request, options, (r, o) =>
      this.deps.inner.generateCompletionOutcome(r, o),
    );
  }

  private async executeWithBudget(
    request: GenerateTextRequest | GenerateCompletionRequest,
    options: ModelGatewayGenerateTextOptions | undefined,
    invoke: (
      request: GenerateTextRequest | GenerateCompletionRequest,
      options: ModelGatewayGenerateTextOptions | undefined,
    ) => Promise<ProviderGenerateTextResult>,
  ): Promise<ProviderGenerateTextResult> {
    if (isModelGatewayBudgetFailClosed(options?.budget)) {
      throw budgetUnavailableError(
        "Workspace inference budget enforcement is active but budget admission is unavailable.",
      );
    }
    if (!isModelGatewayBudgetEnforced(options?.budget)) {
      return invoke(request, options);
    }

    const prepared = await this.prepareBudgetAttempt(request, options);
    if (prepared.kind === "BYPASS") {
      return invoke(request, options);
    }
    const active = prepared;
    if (!active.providerInvocationAuthorized) {
      throw budgetUnavailableError(
        "Inference budget reservation does not authorize another provider invocation.",
      );
    }

    let providerStarted = false;
    try {
      const startedReservation = await this.deps.admission.markProviderStarted({
        workspaceId: active.binding.workspaceId,
        reservationId: active.reservation.id,
        providerRequestId: undefined,
        executionGeneration: active.binding.executionGenerationFence,
        runAttemptId: active.binding.runAttemptId,
        executionOwner: active.binding.executionOwner,
      });
      providerStarted = true;

      const outcome = await invoke(request, options);
      await this.reconcileProviderOutcome({
        active: { ...active, reservation: startedReservation },
        outcome,
        providerAccepted: true,
        cancelledBeforeAccept: false,
      });
      return outcome;
    } catch (error) {
      if (!providerStarted) {
        try {
          await this.deps.admission.release({
            workspaceId: active.binding.workspaceId,
            reservation: active.reservation,
            periodLedger: active.periodLedger,
          });
        } catch (releaseError) {
          throw releaseError;
        }
        throw error;
      }

      const cancelled =
        isModelGatewayError(error) &&
        error.code === MODEL_ERROR_CODES.MODEL_CANCELLED;

      try {
        await this.reconcileProviderOutcome({
          active,
          outcome: undefined,
          providerAccepted: true,
          cancelledBeforeAccept: cancelled,
        });
      } catch (reconcileError) {
        throw reconcileError;
      }
      throw error;
    }
  }

  private async *iterateBudgetedCompletionStream(
    request: GenerateCompletionRequest,
    options: ModelGatewayGenerateTextOptions | undefined,
  ): AsyncGenerator<ModelStreamEvent> {
    const prepared = await this.prepareBudgetAttempt(request, options!);
    if (prepared.kind === "BYPASS") {
      for await (const event of this.deps.inner.generateCompletionStream(
        request,
        options,
      )) {
        yield event;
      }
      return;
    }
    const active = prepared;
    if (!active.providerInvocationAuthorized) {
      throw budgetUnavailableError(
        "Inference budget reservation does not authorize another provider invocation.",
      );
    }

    const startedReservation = await this.deps.admission.markProviderStarted({
      workspaceId: active.binding.workspaceId,
      reservationId: active.reservation.id,
      executionGeneration: active.binding.executionGenerationFence,
      runAttemptId: active.binding.runAttemptId,
      executionOwner: active.binding.executionOwner,
    });
    const activeStarted = { ...active, reservation: startedReservation };

    const inner = this.deps.inner.generateCompletionStream(request, options);
    const collected: ModelStreamEvent[] = [];
    let failed = false;

    try {
      for await (const event of inner) {
        collected.push(event);
        if (
          event.kind === "FAILED" ||
          event.kind === "CANCELLED" ||
          event.kind === "COMPLETED"
        ) {
          if (event.kind === "FAILED" || event.kind === "CANCELLED") {
            failed = true;
          }
        }
        yield event;
      }
    } catch (error) {
      failed = true;
      try {
        await this.reconcileStreamEvents({
          active: activeStarted,
          request,
          events: collected,
          failed: true,
          cancelled:
            isModelGatewayError(error) &&
            error.code === MODEL_ERROR_CODES.MODEL_CANCELLED,
        });
      } catch (reconcileError) {
        throw reconcileError;
      }
      throw error;
    }

    await this.reconcileStreamEvents({
      active: activeStarted,
      request,
      events: collected,
      failed,
      cancelled: collected.some((event) => event.kind === "CANCELLED"),
    });
  }

  private async prepareBudgetAttempt(
    request: GenerateTextRequest | GenerateCompletionRequest,
    options: ModelGatewayGenerateTextOptions,
  ): Promise<PreparedBudgetAttemptV1> {
    if (!isModelGatewayBudgetEnforced(options.budget)) {
      return { kind: "BYPASS" };
    }
    const binding = options.budget;
    assertInferenceBudgetWorkspaceScope({
      workspaceId: binding.workspaceId,
      reservationWorkspaceId: binding.workspaceId,
      ledgerWorkspaceId: binding.workspaceId,
    });

    if (binding.runtimePolicy.enabled !== true) {
      throw budgetUnavailableError(
        "Inference budget enforcement binding requires an enabled runtime policy.",
      );
    }

    const policyDefinition = binding.runtimePolicy.definition;
    const policyVersionId = binding.runtimePolicy.policyVersionId;
    if (policyDefinition === undefined || policyVersionId === undefined) {
      throw budgetUnavailableError(
        "Inference budget runtime policy is missing a definition.",
      );
    }

    const selectedProfileVersionId =
      binding.selectedModelProfileVersionId ?? request.modelProfileVersionId;
    if (selectedProfileVersionId !== request.modelProfileVersionId) {
      throw budgetUnavailableError(
        "Selected model profile identity does not match the routed request.",
      );
    }

    const profileVersion =
      await this.deps.modelProfiles.findModelProfileVersionById(
        selectedProfileVersionId,
      );
    if (profileVersion === null) {
      throw budgetUnavailableError(
        "Model profile version not found for budget.",
      );
    }

    const providerAttemptIndex = binding.providerAttemptIndex ?? 0;
    const anchor = {
      ...binding.anchor,
      invocationKind: binding.invocationKind,
    };
    let invocation;
    try {
      invocation = await this.deps.admission.allocateInvocation({
        workspaceId: binding.workspaceId,
        anchor,
        periodKey: binding.periodKey,
        budgetPolicyVersionId: policyVersionId,
        pricingSnapshotId: binding.pricingSnapshotId,
        runId: binding.runId,
        runAttemptId: binding.runAttemptId,
        runStepId: binding.runStepId,
      });
    } catch {
      throw budgetUnavailableError(
        "Inference budget invocation allocation is unavailable.",
      );
    }
    const reservationKey = deriveInferenceBudgetReservationKey({
      version: "1",
      inferenceInvocationId: invocation.id,
      providerAttemptIndex,
      selectedModelProfileVersionId: selectedProfileVersionId,
    });

    const admitCeiling = this.resolveAdmitCeilingUsdMicros({
      policy: policyDefinition,
      messages: request.messages as GenerateTextRequest["messages"],
      maxOutputTokens: request.maxOutputTokens,
      pricing: profileVersion.pricing,
      configuredProviderModelId: profileVersion.model,
    });

    if (admitCeiling === null) {
      throw budgetUnavailableError(
        "Inference budget admit ceiling could not be resolved.",
      );
    }

    let admission: InferenceBudgetAdmissionOutcomeV1;
    try {
      admission = await this.deps.admission.admitOrGetExisting({
        workspaceId: binding.workspaceId,
        reservationKey,
        admitCeilingUsdMicros: admitCeiling,
        attempt: {
          workspaceId: binding.workspaceId,
          inferenceInvocationId: invocation.id,
          invocationAnchor: buildInferenceInvocationAnchorString(anchor),
          periodKey: binding.periodKey,
          budgetPolicyVersionId: policyVersionId,
          pricingSnapshotId: binding.pricingSnapshotId,
          providerAttemptIndex,
          selectedModelProfileVersionId: selectedProfileVersionId,
          admitCeilingUsdMicros: admitCeiling,
          runStepId: binding.runStepId,
          runAttemptId: binding.runAttemptId,
          admittedExecutionGeneration: binding.executionGenerationFence,
        },
      });
    } catch {
      throw budgetUnavailableError(
        "Inference budget admission authority is unavailable.",
      );
    }

    if (admission.outcome === "BYPASSED") {
      return { kind: "BYPASS" };
    }

    if (admission.outcome === "DENIED") {
      throw new ModelGatewayError(
        MODEL_ERROR_CODES.MODEL_INFERENCE_BUDGET_EXCEEDED,
        "Workspace inference budget capacity is exhausted for this period.",
        { retryable: false },
      );
    }

    const reservation =
      admission.outcome === "ADMITTED" ||
      admission.outcome === "IDEMPOTENT_EXISTING"
        ? admission.reservation
        : undefined;
    if (reservation === undefined) {
      throw budgetUnavailableError("Unexpected budget admission outcome.");
    }

    const { year, monthIndex } = parseInferenceBudgetPeriodKey(
      reservation.periodKey,
    );
    const periodIdentity = resolveInferenceBudgetUtcPeriodIdentity(
      new Date(Date.UTC(year, monthIndex, 15, 12, 0, 0, 0)),
    );
    const periodLedger =
      admission.outcome === "ADMITTED"
        ? admission.periodLedgerAfter
        : createEmptyInferenceBudgetPeriodLedger({
            workspaceId: binding.workspaceId,
            period: periodIdentity,
            budgetPolicyVersionId: reservation.budgetPolicyVersionId,
            limitUsdMicros: policyDefinition.periodLimitUsdMicros,
          });

    const providerInvocationAuthorized = reservation.status === "ADMITTED";

    return {
      kind: "ACTIVE",
      binding,
      policyDefinition,
      reservation,
      periodLedger,
      providerInvocationAuthorized,
    };
  }

  private resolveAdmitCeilingUsdMicros(input: {
    readonly policy: NonNullable<InferenceBudgetRuntimePolicyV1["definition"]>;
    readonly messages: GenerateTextRequest["messages"];
    readonly maxOutputTokens: number | undefined;
    readonly pricing:
      import("@osva-ai/contracts").ModelProfileVersionPricing | undefined;
    readonly configuredProviderModelId: string;
  }): number | null {
    const inputTokens = estimateRoutingInputTokens(
      input.messages as import("@osva-ai/contracts").ModelConversationMessage[],
    );
    const preflight =
      input.pricing === undefined
        ? null
        : estimateRoutingPreflightCostUsdMicros({
            estimatedInputTokens: inputTokens,
            maxOutputTokens: input.maxOutputTokens,
            pricing: input.pricing,
          }).estimatedCostUsdMicros;

    return resolveInferenceBudgetAdmitCeilingUsdMicros({
      policy: input.policy,
      admitCeilingUsdMicros: preflight,
    });
  }

  private async reconcileProviderOutcome(input: {
    readonly active: ActiveBudgetAttemptV1;
    readonly outcome: ProviderGenerateTextResult | undefined;
    readonly providerAccepted: boolean;
    readonly cancelledBeforeAccept: boolean;
  }): Promise<void> {
    const version = await this.deps.modelProfiles.findModelProfileVersionById(
      input.active.reservation.selectedModelProfileVersionId,
    );
    const usage = input.outcome?.usage;
    const usageKnown = usage !== undefined;
    const committed =
      usageKnown && version !== null
        ? estimateModelCostUsdMicros(
            {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cachedInputTokens: usage.cachedInputTokens,
              cacheWriteInputTokens: usage.cacheWriteInputTokens,
            },
            version.pricing,
            {
              configuredProviderModelId: version.model,
              providerReportedModelId:
                input.outcome?.invocation?.providerReportedModelId,
              usageIncomplete: usage.incomplete === true,
            },
          )
        : null;

    const osvaCacheHit =
      input.outcome?.invocationSource === INFERENCE_MODEL_INVOCATION_SOURCES[2];

    if (osvaCacheHit) {
      return;
    }

    await this.deps.admission.reconcile({
      workspaceId: input.active.binding.workspaceId,
      reservation: input.active.reservation,
      periodLedger: input.active.periodLedger,
      committedUsdMicros: committed,
      usageKnown: usageKnown && committed !== null,
      providerAccepted: input.providerAccepted,
      billableProviderOutcome:
        input.providerAccepted && !input.cancelledBeforeAccept,
      nonBillableCancelBeforeAccept: input.cancelledBeforeAccept,
    });
  }

  private async reconcileStreamEvents(input: {
    readonly active: ActiveBudgetAttemptV1;
    readonly request: GenerateCompletionRequest;
    readonly events: readonly ModelStreamEvent[];
    readonly failed: boolean;
    readonly cancelled: boolean;
  }): Promise<void> {
    const verdict = providerOutcomeFromModelStreamEvents(input.events);
    const version = await this.deps.modelProfiles.findModelProfileVersionById(
      input.request.modelProfileVersionId,
    );
    const usage = verdict.outcome?.usage;
    const usageKnown = usage !== undefined;
    const committed =
      usageKnown && version !== null
        ? estimateModelCostUsdMicros(
            {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cachedInputTokens: usage.cachedInputTokens,
              cacheWriteInputTokens: usage.cacheWriteInputTokens,
            },
            version.pricing,
            {
              configuredProviderModelId: version.model,
              providerReportedModelId:
                verdict.outcome?.invocation?.providerReportedModelId,
              usageIncomplete: usage.incomplete === true,
            },
          )
        : null;

    await this.deps.admission.reconcile({
      workspaceId: input.active.binding.workspaceId,
      reservation: input.active.reservation,
      periodLedger: input.active.periodLedger,
      committedUsdMicros: committed,
      usageKnown: usageKnown && committed !== null,
      providerAccepted: !input.cancelled,
      billableProviderOutcome:
        !input.cancelled && (verdict.status === "SUCCEEDED" || input.failed),
      nonBillableCancelBeforeAccept: input.cancelled,
    });
  }

  private cancelledBeforeAcceptStream(input: {
    readonly cancelled: boolean;
    readonly events: readonly ModelStreamEvent[];
  }): boolean {
    return input.cancelled;
  }
}

function budgetUnavailableError(message: string): ModelGatewayError {
  return new ModelGatewayError(
    MODEL_ERROR_CODES.MODEL_INFERENCE_BUDGET_UNAVAILABLE,
    message,
    { retryable: false },
  );
}
