import { randomUUID } from "node:crypto";

import type { BuilderGenerationAttemptDiagnosticV1 } from "@osva/domain/builder";

import {
  parseLiveBuilderGenerationBody,
  probeArtifactBuilderErrorCode,
  sanitizeBuilderGenerationFailure,
  type LiveBuilderGenerationResponseShape,
  type M20_7SanitizedBuilderGenerationFailure,
  type M20_7SanitizedBuilderProviderDiagnostic,
} from "./m20-7-live-eval.js";

export const M20_7_GEMINI_PROBE_ARTIFACT = "gemini-generation-probe.json";

export type M20_7GeminiGenerationProbeOutcome =
  | "PROBE_DRY_RUN"
  | "PROBE_BLOCKED"
  | "PROVIDER_RESPONSE_ACCEPTED"
  | "BUILDER_GENERATION_PASS"
  | "PROVIDER_HTTP_ERROR"
  | "TRANSPORT_ERROR"
  | "ADAPTER_ERROR"
  | "BUILDER_VALIDATION_ERROR";

export interface M20_7GeminiGenerationProbeArtifactV1 {
  readonly schemaVersion: "1";
  readonly harnessVersion: "m20-7.3";
  readonly runId: string;
  readonly mode: "dry_run" | "execute";
  readonly sourceCommit?: string;
  readonly blockedReason?: string;
  readonly outcome: M20_7GeminiGenerationProbeOutcome;
  readonly provider: "GOOGLE_GEMINI";
  readonly modelId: string;
  readonly structuredOutputWire: "responseJsonSchema";
  readonly invocationAttempted: boolean;
  readonly providerAttempts: number;
  readonly repairAttempted: boolean;
  readonly latencyMs?: number;
  readonly httpStatus?: number;
  readonly builderErrorCode?: string;
  readonly providerDiagnostic?: M20_7SanitizedBuilderProviderDiagnostic;
  readonly providerResponseAccepted: boolean;
  readonly builderGenerationPass: boolean;
  readonly measuredUsage?: {
    readonly usageMeasured: boolean;
    readonly inputUnits?: number;
    readonly outputUnits?: number;
  };
  readonly modelFinishReason?: string;
  readonly validationStage?: BuilderGenerationAttemptDiagnosticV1["validationStage"];
  readonly compileIssueCodes?: readonly string[];
  readonly attemptDiagnostics?: readonly BuilderGenerationAttemptDiagnosticV1[];
  readonly budgets: {
    readonly maxProviderInvocations: number;
    readonly maxEstimatedCostUsdMicros?: number;
    readonly maxInputTokensPerAttempt?: number;
    readonly maxOutputTokensPerAttempt?: number;
    readonly estimatedWorstCaseMicroUsd?: number;
    readonly estimatedWorstCaseReason?: string;
  };
  readonly notes?: string;
}

const FORBIDDEN_ARTIFACT_KEYS = new Set([
  "proposal",
  "candidateProposal",
  "userInstruction",
  "rawPrompt",
  "apiKey",
  "authorization",
]);

export function geminiProbeSmokeInstruction(): string {
  return "Create a workflow that summarizes weekly product feedback. The agent should identify recurring themes, highlight critical issues, and produce actionable recommendations. Do not use external tools.";
}

export function providerAdapterAcceptedResponse(input: {
  readonly parsed?: LiveBuilderGenerationResponseShape;
  readonly failure?: M20_7SanitizedBuilderGenerationFailure;
  readonly providerAttempts: number;
}): boolean {
  const attempts = input.parsed?.metadata?.attemptDiagnostics ?? [];
  const providerStageOnly =
    attempts.length > 0 &&
    attempts.every((a) => a.validationStage === "provider_invocation");
  if (providerStageOnly) {
    return false;
  }
  const usage = input.parsed?.metadata?.measuredUsage;
  if (usage?.usageMeasured === true) {
    return true;
  }
  if (input.parsed?.ok === true) {
    return true;
  }
  if (
    input.failure?.providerDiagnostic?.providerTransportErrorCategory ===
    "response_body_parse_failed"
  ) {
    return true;
  }
  const first = attempts[0];
  if (first !== undefined && first.validationStage !== "provider_invocation") {
    return true;
  }
  return false;
}

export function classifyGeminiGenerationProbeOutcome(input: {
  readonly httpStatus: number;
  readonly parsed?: LiveBuilderGenerationResponseShape;
  readonly failure?: M20_7SanitizedBuilderGenerationFailure;
  readonly providerAttempts: number;
}): M20_7GeminiGenerationProbeOutcome {
  if (input.parsed?.ok === true) {
    return "BUILDER_GENERATION_PASS";
  }

  if (providerAdapterAcceptedResponse(input)) {
    return "BUILDER_VALIDATION_ERROR";
  }

  const pd = input.failure?.providerDiagnostic;
  const transport = pd?.providerTransportErrorCategory;

  if (
    transport === "connection_failed" ||
    transport === "response_body_read_failed"
  ) {
    return "TRANSPORT_ERROR";
  }

  if (
    transport === "request_construction" ||
    transport === "request_serialization" ||
    transport === "response_body_parse_failed"
  ) {
    return "ADAPTER_ERROR";
  }

  if (pd?.providerHttpResponseObserved === true) {
    return "PROVIDER_HTTP_ERROR";
  }

  const builderCode =
    input.failure?.builderErrorCode ?? input.parsed?.errorCode;
  if (
    builderCode !== undefined &&
    (builderCode.startsWith("PROVIDER_") ||
      builderCode === "GENERATION_DEADLINE_EXCEEDED")
  ) {
    return "TRANSPORT_ERROR";
  }

  return "ADAPTER_ERROR";
}

export function buildGeminiGenerationProbeArtifact(input: {
  readonly mode: "dry_run" | "execute";
  readonly modelId: string;
  readonly sourceCommit?: string;
  readonly blockedReason?: string;
  readonly httpStatus?: number;
  readonly latencyMs?: number;
  readonly parsed?: LiveBuilderGenerationResponseShape;
  readonly maxProviderInvocations: number;
  readonly maxEstimatedCostUsdMicros?: number;
  readonly maxInputTokensPerAttempt?: number;
  readonly maxOutputTokensPerAttempt?: number;
  readonly estimatedWorstCaseMicroUsd?: number;
  readonly estimatedWorstCaseReason?: string;
  readonly invocationAttempted: boolean;
  readonly notes?: string;
}): M20_7GeminiGenerationProbeArtifactV1 {
  const failure =
    input.httpStatus !== undefined && input.parsed !== undefined
      ? sanitizeBuilderGenerationFailure(input.httpStatus, input.parsed)
      : undefined;

  const providerAttempts = input.parsed?.metadata?.attempts ?? 0;
  const attemptDiagnostics = failure?.attemptDiagnostics;
  const repairAttempted =
    attemptDiagnostics?.some((a) => a.repairAttempted === true) ?? false;
  const firstAttempt = attemptDiagnostics?.[0];
  const compileIssueCodes = failure?.compileIssues?.map((i) => i.code);

  const providerAccepted =
    input.mode === "execute" && input.parsed !== undefined
      ? providerAdapterAcceptedResponse({
          parsed: input.parsed,
          failure,
          providerAttempts,
        })
      : false;

  const builderPass = input.parsed?.ok === true;

  const finalOutcome: M20_7GeminiGenerationProbeOutcome =
    input.blockedReason !== undefined
      ? "PROBE_BLOCKED"
      : input.mode === "dry_run"
        ? "PROBE_DRY_RUN"
        : input.parsed === undefined || input.httpStatus === undefined
          ? "ADAPTER_ERROR"
          : classifyGeminiGenerationProbeOutcome({
              httpStatus: input.httpStatus,
              parsed: input.parsed,
              failure,
              providerAttempts,
            });

  return {
    schemaVersion: "1",
    harnessVersion: "m20-7.3",
    runId: randomUUID(),
    mode: input.mode,
    sourceCommit: input.sourceCommit,
    blockedReason: input.blockedReason,
    outcome: finalOutcome,
    provider: "GOOGLE_GEMINI",
    modelId: input.modelId,
    structuredOutputWire: "responseJsonSchema",
    invocationAttempted: input.invocationAttempted,
    providerAttempts,
    repairAttempted,
    latencyMs: input.latencyMs,
    httpStatus: input.httpStatus,
    builderErrorCode: probeArtifactBuilderErrorCode(input.parsed, failure),
    providerDiagnostic: failure?.providerDiagnostic,
    providerResponseAccepted: providerAccepted,
    builderGenerationPass: builderPass,
    measuredUsage:
      (failure?.measuredUsage ?? input.parsed?.metadata?.measuredUsage)
        ? {
            usageMeasured:
              (failure?.measuredUsage?.usageMeasured ??
                input.parsed?.metadata?.measuredUsage?.usageMeasured) === true,
            inputUnits:
              failure?.measuredUsage?.inputUnits ??
              input.parsed?.metadata?.measuredUsage?.inputUnits,
            outputUnits:
              failure?.measuredUsage?.outputUnits ??
              input.parsed?.metadata?.measuredUsage?.outputUnits,
          }
        : undefined,
    modelFinishReason: firstAttempt?.modelFinishReason,
    validationStage: firstAttempt?.validationStage,
    compileIssueCodes,
    attemptDiagnostics,
    budgets: {
      maxProviderInvocations: input.maxProviderInvocations,
      maxEstimatedCostUsdMicros: input.maxEstimatedCostUsdMicros,
      maxInputTokensPerAttempt: input.maxInputTokensPerAttempt,
      maxOutputTokensPerAttempt: input.maxOutputTokensPerAttempt,
      ...(input.estimatedWorstCaseMicroUsd !== undefined
        ? { estimatedWorstCaseMicroUsd: input.estimatedWorstCaseMicroUsd }
        : input.estimatedWorstCaseReason !== undefined
          ? { estimatedWorstCaseReason: input.estimatedWorstCaseReason }
          : {}),
    },
    notes: input.notes,
  };
}

export function geminiGenerationProbeExecuteExitCode(
  outcome: M20_7GeminiGenerationProbeOutcome,
): number {
  if (outcome === "BUILDER_GENERATION_PASS") {
    return 0;
  }
  if (outcome === "PROBE_DRY_RUN" || outcome === "PROBE_BLOCKED") {
    return 0;
  }
  return 1;
}

export function assertGeminiProbeArtifactSanitized(
  artifact: Record<string, unknown>,
): void {
  const walk = (value: unknown, path: string): void => {
    if (value === null || typeof value !== "object") {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item, path);
      }
      return;
    }
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (FORBIDDEN_ARTIFACT_KEYS.has(key)) {
        throw new Error(`artifact_forbidden_field:${key}`);
      }
      if (child !== undefined) {
        const lower = JSON.stringify(child).toLowerCase();
        if (lower.includes("sk-") || lower.includes("api_key=")) {
          throw new Error(`artifact_possible_secret_at:${key}`);
        }
        walk(child, `${path}.${key}`);
      }
    }
  };
  walk(artifact, "");
}

export function parseProbeGenerationResponse(
  httpStatus: number,
  body: unknown,
): LiveBuilderGenerationResponseShape | undefined {
  return parseLiveBuilderGenerationBody(httpStatus, body);
}
