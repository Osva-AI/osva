import {
  sanitizeCompileIssuesForEvidence,
  type BuilderGenerationAttemptDiagnosticV1,
  type BuilderGenerationCompileIssueEvidenceV1,
  type BuilderGenerationMeasuredUsageV1,
  type BuilderIssueV1,
} from "@osva/domain/builder";
import type { BuilderProposalV1 } from "@osva/domain/builder";
import {
  buildBuilderCatalogIndex,
  compileBuilderProposalPrePublication,
} from "@osva/domain/builder";
import type { WorkspaceBuilderCapabilityCatalogV1 } from "@osva/domain/builder";
import type { BuilderProposalChangesetV1 } from "@osva/domain/builder";

import {
  scoreProposalTopology,
  type M20_6ScenarioResult,
} from "./m20-6-eval.js";

/** Conservative micro-USD per 1M tokens — keep aligned with scripts/acceptance/m20-7/lib/pricing.mjs */
const LIVE_MODEL_PRICING: Readonly<
  Record<string, { inputUsdPer1M: number; outputUsdPer1M: number }>
> = {
  "gpt-4o-mini": { inputUsdPer1M: 150_000, outputUsdPer1M: 600_000 },
  "gpt-4o": { inputUsdPer1M: 2_500_000, outputUsdPer1M: 10_000_000 },
  "gemini-3.6-flash": { inputUsdPer1M: 750_000, outputUsdPer1M: 3_750_000 },
  "gemini-2.5-flash": { inputUsdPer1M: 150_000, outputUsdPer1M: 600_000 },
  "claude-sonnet-5-5": { inputUsdPer1M: 2_000_000, outputUsdPer1M: 10_000_000 },
};

export const M20_7_OFFICIAL_ENDPOINTS = {
  OPENAI: "https://api.openai.com/v1",
  GOOGLE_GEMINI: "https://generativelanguage.googleapis.com/v1beta",
  ANTHROPIC: "https://api.anthropic.com",
} as const;

export interface M20_7LiveProvenanceState {
  liveModeRequested: boolean;
  liveModeAuthorized: boolean;
  /** Successful provider invocations with verified official destination. */
  actualProviderCallsObserved: number;
  /**
   * ModelGateway attempts reported in builder metadata (includes failed invocations).
   */
  providerInvocationAttemptsObserved: number;
  providerIdentityVerified: boolean;
  providerCategory?: string;
  modelIdentifier?: string;
  connectionVersionId?: string;
  verifiedDestinationCategory?: string;
  verificationCode?: string;
  lastBuilderGenerationFailure?: M20_7SanitizedBuilderGenerationFailure;
}

export interface M20_7SanitizedBuilderProviderDiagnostic {
  readonly modelGatewayErrorCode: string;
  readonly provider?: string;
  readonly providerHttpStatus?: number;
  readonly providerErrorType?: string;
  readonly providerErrorCode?: string;
  readonly providerErrorParam?: string;
  readonly providerRequestId?: string;
  readonly retryable?: boolean;
  readonly providerHttpResponseObserved: boolean;
  readonly providerTransportErrorCategory?: string;
}

export interface M20_7SanitizedBuilderGenerationFailure {
  readonly httpStatus: number;
  readonly builderErrorCode: string;
  readonly builderMessage: string;
  readonly providerAttempts: number;
  readonly measuredUsage?: {
    readonly usageMeasured: boolean;
    readonly inputUnits?: number;
    readonly outputUnits?: number;
    readonly cachedUnits?: number;
  };
  readonly detailMessages?: readonly string[];
  readonly structuredOutputMode?: string;
  readonly generationProvider?: string;
  readonly providerDiagnostic?: M20_7SanitizedBuilderProviderDiagnostic;
  readonly providerDiagnosticUnavailableReason?: string;
  readonly compileIssues?: readonly BuilderGenerationCompileIssueEvidenceV1[];
  readonly attemptDiagnostics?: readonly BuilderGenerationAttemptDiagnosticV1[];
}

export interface LiveBuilderGenerationResponseShape {
  readonly ok: boolean;
  readonly proposal?: BuilderProposalV1;
  readonly errorCode?: string;
  readonly message?: string;
  readonly detailMessages?: readonly string[];
  readonly compileIssues?: readonly BuilderIssueV1[];
  readonly providerDiagnostic?: {
    readonly modelGatewayErrorCode?: string;
    readonly provider?: string;
    readonly providerHttpStatus?: number;
    readonly providerErrorType?: string;
    readonly providerErrorCode?: string;
    readonly providerErrorParam?: string;
    readonly providerRequestId?: string;
    readonly retryable?: boolean;
    readonly providerHttpResponseObserved?: boolean;
    readonly providerTransportErrorCategory?: string;
  };
  readonly metadata?: {
    readonly attempts?: number;
    readonly generationProvider?: string;
    readonly structuredOutputMode?: string;
    readonly measuredUsage?: {
      readonly usageMeasured?: boolean;
      readonly inputUnits?: number;
      readonly outputUnits?: number;
      readonly cachedUnits?: number;
    };
    readonly attemptDiagnostics?: readonly BuilderGenerationAttemptDiagnosticV1[];
  };
}

export function parseLiveBuilderGenerationBody(
  _httpStatus: number,
  body: unknown,
): LiveBuilderGenerationResponseShape | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.ok !== "boolean") {
    return undefined;
  }
  return body as LiveBuilderGenerationResponseShape;
}

const SAFE_PROVIDER_TOKEN = /^[A-Za-z0-9_.:-]{1,128}$/;

function sanitizeMeasuredUsageForAttemptDiagnostic(
  raw: unknown,
): BuilderGenerationMeasuredUsageV1 | undefined {
  if (raw === undefined || typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const usageMeasured = record.usageMeasured === true;
  const inputUnits =
    typeof record.inputUnits === "number" && Number.isFinite(record.inputUnits)
      ? record.inputUnits
      : undefined;
  const outputUnits =
    typeof record.outputUnits === "number" &&
    Number.isFinite(record.outputUnits)
      ? record.outputUnits
      : undefined;

  if (!usageMeasured) {
    return {
      usageMeasured: false,
      inputUnits: inputUnits ?? 0,
      outputUnits: outputUnits ?? 0,
    };
  }

  if (inputUnits === undefined || outputUnits === undefined) {
    return undefined;
  }

  const cachedUnits =
    typeof record.cachedUnits === "number" &&
    Number.isFinite(record.cachedUnits)
      ? record.cachedUnits
      : undefined;

  return cachedUnits === undefined
    ? { usageMeasured: true, inputUnits, outputUnits }
    : { usageMeasured: true, inputUnits, outputUnits, cachedUnits };
}

function sanitizeProviderDiagnosticField(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || !SAFE_PROVIDER_TOKEN.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function sanitizeProviderDiagnosticFromBody(
  parsed: LiveBuilderGenerationResponseShape,
): M20_7SanitizedBuilderProviderDiagnostic | undefined {
  const raw = parsed.providerDiagnostic;
  if (raw === undefined || typeof raw !== "object" || raw === null) {
    return undefined;
  }

  const code = sanitizeProviderDiagnosticField(raw.modelGatewayErrorCode);
  if (code === undefined) {
    return undefined;
  }

  const providerHttpStatus =
    typeof raw.providerHttpStatus === "number" &&
    Number.isInteger(raw.providerHttpStatus) &&
    raw.providerHttpStatus >= 100 &&
    raw.providerHttpStatus <= 599
      ? raw.providerHttpStatus
      : undefined;

  return {
    modelGatewayErrorCode: code,
    provider: sanitizeProviderDiagnosticField(raw.provider),
    providerHttpStatus,
    providerErrorType: sanitizeProviderDiagnosticField(raw.providerErrorType),
    providerErrorCode: sanitizeProviderDiagnosticField(raw.providerErrorCode),
    providerErrorParam: sanitizeProviderDiagnosticField(raw.providerErrorParam),
    providerRequestId: sanitizeProviderDiagnosticField(raw.providerRequestId),
    retryable: typeof raw.retryable === "boolean" ? raw.retryable : undefined,
    providerHttpResponseObserved:
      raw.providerHttpResponseObserved === true ||
      providerHttpStatus !== undefined,
    providerTransportErrorCategory: sanitizeProviderDiagnosticField(
      raw.providerTransportErrorCategory,
    ),
  };
}

export function sanitizeBuilderGenerationFailure(
  httpStatus: number,
  parsed: LiveBuilderGenerationResponseShape,
): M20_7SanitizedBuilderGenerationFailure {
  const attempts = parsed.metadata?.attempts ?? 0;
  const usage = parsed.metadata?.measuredUsage;
  const providerDiagnostic = sanitizeProviderDiagnosticFromBody(parsed);
  const providerDiagnosticUnavailableReason =
    providerDiagnostic === undefined &&
    parsed.ok === false &&
    isProviderRelatedBuilderError(parsed.errorCode)
      ? parsed.providerDiagnostic === undefined
        ? "BUILDER_RESPONSE_MISSING_PROVIDER_DIAGNOSTIC"
        : "BUILDER_RESPONSE_MALFORMED_PROVIDER_DIAGNOSTIC"
      : undefined;
  return {
    httpStatus,
    builderErrorCode: String(parsed.errorCode ?? "UNKNOWN_BUILDER_FAILURE"),
    builderMessage: String(parsed.message ?? "").slice(0, 500),
    providerAttempts: attempts,
    measuredUsage:
      usage === undefined
        ? undefined
        : {
            usageMeasured: usage.usageMeasured === true,
            inputUnits: usage.inputUnits,
            outputUnits: usage.outputUnits,
            cachedUnits: usage.cachedUnits,
          },
    detailMessages: Array.isArray(parsed.detailMessages)
      ? parsed.detailMessages.map((m) => String(m).slice(0, 200)).slice(0, 8)
      : undefined,
    structuredOutputMode: parsed.metadata?.structuredOutputMode,
    generationProvider: parsed.metadata?.generationProvider,
    providerDiagnostic,
    ...(providerDiagnosticUnavailableReason === undefined
      ? {}
      : { providerDiagnosticUnavailableReason }),
    compileIssues: sanitizeCompileIssuesForEvidence(parsed.compileIssues),
    attemptDiagnostics: sanitizeAttemptDiagnosticsFromBody(
      parsed.metadata?.attemptDiagnostics,
    ),
  };
}

/**
 * Probe JSON artifacts must not invent UNKNOWN_BUILDER_FAILURE on success.
 * `sanitizeBuilderGenerationFailure` always fills `builderErrorCode`
 * (including when a 200/ok body has no `errorCode`). Success omits the field.
 */
export function probeArtifactBuilderErrorCode(
  parsed: LiveBuilderGenerationResponseShape | undefined,
  failure?: M20_7SanitizedBuilderGenerationFailure,
): string | undefined {
  if (parsed?.ok === true) {
    return undefined;
  }
  const code = failure?.builderErrorCode ?? parsed?.errorCode;
  return typeof code === "string" && code.length > 0 ? code : undefined;
}

function sanitizeAttemptDiagnosticsFromBody(
  raw: readonly BuilderGenerationAttemptDiagnosticV1[] | undefined,
): readonly BuilderGenerationAttemptDiagnosticV1[] | undefined {
  if (raw === undefined || !Array.isArray(raw) || raw.length === 0) {
    return undefined;
  }

  const sanitized: BuilderGenerationAttemptDiagnosticV1[] = [];
  for (const entry of raw.slice(0, 4)) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.providerAttempt !== "number" ||
      !Number.isInteger(record.providerAttempt)
    ) {
      continue;
    }
    if (typeof record.errorCode !== "string" || record.errorCode.length === 0) {
      continue;
    }
    if (typeof record.validationStage !== "string") {
      continue;
    }
    sanitized.push({
      providerAttempt: record.providerAttempt,
      afterRepair: record.afterRepair === true,
      repairAttempted: record.repairAttempted === true,
      validationStage:
        record.validationStage as BuilderGenerationAttemptDiagnosticV1["validationStage"],
      errorCode:
        record.errorCode as BuilderGenerationAttemptDiagnosticV1["errorCode"],
      detailMessages: Array.isArray(record.detailMessages)
        ? record.detailMessages
            .filter((m): m is string => typeof m === "string")
            .map((m) => m.slice(0, 200))
            .slice(0, 8)
        : undefined,
      compileIssues: sanitizeCompileIssuesForEvidence(
        Array.isArray(record.compileIssues)
          ? (record.compileIssues as BuilderIssueV1[])
          : undefined,
      ),
      modelFinishReason:
        typeof record.modelFinishReason === "string"
          ? (record.modelFinishReason as BuilderGenerationAttemptDiagnosticV1["modelFinishReason"])
          : undefined,
      measuredUsage: sanitizeMeasuredUsageForAttemptDiagnostic(
        record.measuredUsage,
      ),
    });
  }

  return sanitized.length > 0 ? sanitized : undefined;
}

function isProviderRelatedBuilderError(errorCode: string | undefined): boolean {
  return (
    errorCode === "PROVIDER_ERROR" ||
    errorCode === "PROVIDER_UNAVAILABLE" ||
    errorCode === "PROVIDER_TIMEOUT"
  );
}

export function providerEvidenceForScenario(input: {
  readonly failure?: M20_7SanitizedBuilderGenerationFailure;
  readonly parsed?: LiveBuilderGenerationResponseShape;
}):
  | {
      readonly providerDiagnostic: M20_7SanitizedBuilderProviderDiagnostic;
      readonly providerDiagnosticUnavailableReason?: undefined;
    }
  | {
      readonly providerDiagnostic?: undefined;
      readonly providerDiagnosticUnavailableReason: string;
    }
  | Record<string, never> {
  if (input.failure?.providerDiagnostic !== undefined) {
    return { providerDiagnostic: input.failure.providerDiagnostic };
  }
  if (input.parsed !== undefined) {
    const direct = sanitizeProviderDiagnosticFromBody(input.parsed);
    if (direct !== undefined) {
      return { providerDiagnostic: direct };
    }
  }
  const gap = input.failure?.providerDiagnosticUnavailableReason;
  if (gap !== undefined) {
    return { providerDiagnosticUnavailableReason: gap };
  }
  if (
    input.parsed?.ok === false &&
    isProviderRelatedBuilderError(input.parsed.errorCode)
  ) {
    return {
      providerDiagnosticUnavailableReason:
        input.parsed.providerDiagnostic === undefined
          ? "BUILDER_RESPONSE_MISSING_PROVIDER_DIAGNOSTIC"
          : "BUILDER_RESPONSE_MALFORMED_PROVIDER_DIAGNOSTIC",
    };
  }
  return {};
}

export function formatProviderDiagnosticForVitest(
  failure: M20_7SanitizedBuilderGenerationFailure | undefined,
  parsed: LiveBuilderGenerationResponseShape | undefined,
): string {
  const pd =
    failure?.providerDiagnostic ??
    (parsed !== undefined
      ? sanitizeProviderDiagnosticFromBody(parsed)
      : undefined);
  if (pd === undefined) {
    const evidence = providerEvidenceForScenario({ failure, parsed });
    const reason =
      failure?.providerDiagnosticUnavailableReason ??
      ("providerDiagnosticUnavailableReason" in evidence
        ? evidence.providerDiagnosticUnavailableReason
        : undefined);
    return reason === undefined
      ? "providerDiagnostic=n/a"
      : `providerDiagnosticUnavailableReason=${reason}`;
  }
  const parts = [
    `providerHttpStatus=${String(pd.providerHttpStatus ?? "?")}`,
    `modelGatewayErrorCode=${pd.modelGatewayErrorCode}`,
    `providerErrorCode=${pd.providerErrorCode ?? "n/a"}`,
    `providerErrorParam=${pd.providerErrorParam ?? "n/a"}`,
    `providerHttpResponseObserved=${String(pd.providerHttpResponseObserved)}`,
  ];
  return parts.join(" ");
}

export interface M20_7LiveBudgetSnapshot {
  maxBuilderRequests: number;
  maxProviderInvocations: number;
  maxTotalDurationMs: number;
  maxEstimatedCostUsdMicros?: number;
  builderRequestsUsed: number;
  providerInvocationsUsed: number;
  estimatedCostUsdMicros: number;
  startedAtMs: number;
}

export interface LiveSmokeManifestOperation {
  readonly id: string;
  readonly kind: "generate" | "refine";
  readonly userInstruction?: string;
  readonly refinementInstruction?: string;
  readonly structural?: Record<string, unknown>;
  readonly intentRubric?: readonly string[];
  readonly refinementExpectations?: Record<string, unknown>;
  readonly forbiddenInstructionMarkers?: readonly string[];
}

function intEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loadLiveBudgetFromEnv(smoke: boolean): M20_7LiveBudgetSnapshot {
  const env = process.env;
  return {
    maxBuilderRequests: intEnv(
      env.OSVA_M20_7_MAX_BUILDER_REQUESTS,
      smoke ? 2 : 6,
    ),
    maxProviderInvocations: intEnv(
      env.OSVA_M20_7_MAX_PROVIDER_INVOCATIONS,
      smoke ? 4 : 12,
    ),
    maxTotalDurationMs: intEnv(
      env.OSVA_M20_7_MAX_TOTAL_DURATION_MS,
      smoke ? 180_000 : 600_000,
    ),
    maxEstimatedCostUsdMicros: env.OSVA_M20_7_MAX_COST_USD_MICROS
      ? Number(env.OSVA_M20_7_MAX_COST_USD_MICROS)
      : undefined,
    builderRequestsUsed: 0,
    providerInvocationsUsed: 0,
    estimatedCostUsdMicros: 0,
    startedAtMs: Date.now(),
  };
}

export function budgetGateExceeded(
  budget: M20_7LiveBudgetSnapshot,
  kind: "builder" | "provider",
): string | undefined {
  const elapsed = Date.now() - budget.startedAtMs;
  if (elapsed > budget.maxTotalDurationMs) {
    return "BUDGET_EXCEEDED:MAX_TOTAL_DURATION";
  }
  if (
    kind === "builder" &&
    budget.builderRequestsUsed + 1 > budget.maxBuilderRequests
  ) {
    return "BUDGET_EXCEEDED:MAX_BUILDER_REQUESTS";
  }
  if (
    kind === "provider" &&
    budget.providerInvocationsUsed + 1 > budget.maxProviderInvocations
  ) {
    return "BUDGET_EXCEEDED:MAX_PROVIDER_INVOCATIONS";
  }
  return undefined;
}

export function estimateUsageCostMicroUsd(
  modelId: string,
  inputUnits: number,
  outputUnits: number,
): number | undefined {
  const row = LIVE_MODEL_PRICING[modelId.trim()];
  if (row === undefined) {
    return undefined;
  }
  const inputMicro = (inputUnits / 1_000_000) * row.inputUsdPer1M;
  const outputMicro = (outputUnits / 1_000_000) * row.outputUsdPer1M;
  return Math.ceil(inputMicro + outputMicro);
}

export function recordLiveProvenanceFromMetadata(
  state: M20_7LiveProvenanceState,
  input: {
    provider: string;
    modelId: string;
    connectionVersionId: string;
    endpointBaseUrl: string;
    attempts: number;
    invocationSucceeded: boolean;
    forbiddenOrigins: readonly string[];
  },
): void {
  const normalized = input.endpointBaseUrl.replace(/\/+$/, "");
  for (const forbidden of input.forbiddenOrigins) {
    if (normalized === forbidden || normalized.startsWith(`${forbidden}/`)) {
      state.verificationCode = "FAKE_PROVIDER_FALLBACK";
      state.providerIdentityVerified = false;
      return;
    }
  }
  if (normalized.includes("127.0.0.1") || normalized.includes("localhost")) {
    state.verificationCode = "UNVERIFIED_PROVIDER";
    state.providerIdentityVerified = false;
    return;
  }

  state.providerCategory = input.provider.toUpperCase();
  state.modelIdentifier = input.modelId;
  state.connectionVersionId = input.connectionVersionId;
  state.verifiedDestinationCategory =
    normalized === M20_7_OFFICIAL_ENDPOINTS.OPENAI.replace(/\/+$/, "") ||
    normalized === M20_7_OFFICIAL_ENDPOINTS.GOOGLE_GEMINI.replace(/\/+$/, "") ||
    normalized === M20_7_OFFICIAL_ENDPOINTS.ANTHROPIC.replace(/\/+$/, "")
      ? "OFFICIAL"
      : "CUSTOM_PUBLIC";

  if (input.attempts > 0) {
    state.providerInvocationAttemptsObserved += input.attempts;
    state.actualProviderCallsObserved += input.attempts;
  }

  const officialEndpoint = state.verifiedDestinationCategory === "OFFICIAL";

  if (input.invocationSucceeded) {
    state.providerIdentityVerified = officialEndpoint;
    if (!officialEndpoint) {
      state.verificationCode = "UNVERIFIED_PROVIDER";
    }
  } else if (input.attempts > 0) {
    state.providerIdentityVerified = officialEndpoint;
    state.verificationCode = officialEndpoint
      ? "BUILDER_VALIDATION_FAILED_AFTER_PROVIDER"
      : "ADAPTER_INVOCATION_FAILED";
  } else {
    state.verificationCode = "NO_PROVIDER_INVOCATION_REPORTED";
    state.providerIdentityVerified = false;
  }
}

export function recordLiveProvenanceFromGenerationHttp(
  state: M20_7LiveProvenanceState,
  input: {
    readonly httpStatus: number;
    readonly parsed: LiveBuilderGenerationResponseShape | undefined;
    readonly provider: string;
    readonly modelId: string;
    readonly connectionVersionId: string;
    readonly endpointBaseUrl: string;
    readonly forbiddenOrigins: readonly string[];
  },
): M20_7SanitizedBuilderGenerationFailure | undefined {
  if (input.parsed === undefined) {
    state.verificationCode = "BUILDER_RESPONSE_UNPARSEABLE";
    return undefined;
  }

  const attempts = input.parsed.metadata?.attempts ?? 0;
  const invocationSucceeded =
    input.httpStatus === 200 && input.parsed.ok === true;

  recordLiveProvenanceFromMetadata(state, {
    provider: input.provider,
    modelId: input.modelId,
    connectionVersionId: input.connectionVersionId,
    endpointBaseUrl: input.endpointBaseUrl,
    attempts,
    invocationSucceeded,
    forbiddenOrigins: input.forbiddenOrigins,
  });

  if (input.parsed.ok === true) {
    return undefined;
  }

  const failure = sanitizeBuilderGenerationFailure(
    input.httpStatus,
    input.parsed,
  );
  state.lastBuilderGenerationFailure = failure;
  return failure;
}

function countToolBindings(proposal: BuilderProposalV1): number {
  let n = 0;
  for (const agent of proposal.agents) {
    if (agent.kind === "NEW") {
      n += agent.tools.length;
    }
  }
  return n;
}

function instructionBlob(proposal: BuilderProposalV1): string {
  return proposal.agents
    .filter((a) => a.kind === "NEW")
    .map((a) => a.instructions ?? "")
    .join("\n")
    .toLowerCase();
}

export function scoreLiveGenerationStructural(
  proposal: BuilderProposalV1,
  catalog: WorkspaceBuilderCapabilityCatalogV1,
  structural: Record<string, unknown> | undefined,
): { score: 0 | 1 | 2; reasons: string[] } {
  const reasons: string[] = [];
  const requireNodeTypes = (structural?.requireNodeTypes ?? []) as string[];
  const forbidNodeTypes = (structural?.forbidNodeTypes ?? []) as string[];
  const topology = scoreProposalTopology(proposal, requireNodeTypes);
  if (topology < 2) {
    reasons.push("topology_requirements");
  }
  for (const forbidden of forbidNodeTypes) {
    if (proposal.workflow.nodes.some((n) => n.type === forbidden)) {
      reasons.push(`forbidden_node:${forbidden}`);
    }
  }

  const newAgents = proposal.agents.filter((a) => a.kind === "NEW");
  if (
    typeof structural?.minNewAgents === "number" &&
    newAgents.length < structural.minNewAgents
  ) {
    reasons.push("min_new_agents");
  }
  if (
    typeof structural?.maxNewAgents === "number" &&
    newAgents.length > structural.maxNewAgents
  ) {
    reasons.push("max_new_agents");
  }
  if (
    typeof structural?.maxToolBindings === "number" &&
    countToolBindings(proposal) > structural.maxToolBindings
  ) {
    reasons.push("tool_bindings");
  }

  const index = buildBuilderCatalogIndex(catalog);
  const compiled = compileBuilderProposalPrePublication(proposal, index);
  const blocking = compiled.issues.filter((i) => i.severity === "error");
  if (blocking.length > 0) {
    reasons.push("compile_blocking");
  }

  if (reasons.length === 0) {
    return { score: 2, reasons: [] };
  }
  if (reasons.length === 1 && topology === 1) {
    return { score: 1, reasons };
  }
  return { score: reasons.length <= 1 ? 1 : 0, reasons };
}

export function scoreLiveGenerationIntent(
  proposal: BuilderProposalV1,
  rubric: readonly string[] | undefined,
): { score: 0 | 1 | 2; reasons: string[]; requiresHumanReview: boolean } {
  const reasons: string[] = [];
  const text = instructionBlob(proposal);
  const rubricSet = new Set(rubric ?? []);

  if (rubricSet.has("feedback_summarization_objective")) {
    const themeHints = ["theme", "recurring", "feedback", "issue", "recommend"];
    const hit = themeHints.filter((w) => text.includes(w)).length;
    if (hit < 2) {
      reasons.push("feedback_summarization_objective");
    }
  }

  if (rubricSet.has("no_invented_tools") && countToolBindings(proposal) > 0) {
    reasons.push("no_invented_tools");
  }

  if (rubricSet.has("valid_model_binding")) {
    const newAgents = proposal.agents.filter((a) => a.kind === "NEW");
    if (
      newAgents.some(
        (a) =>
          a.kind === "NEW" &&
          (a.model.modelProfileVersionId === undefined ||
            String(a.model.modelProfileVersionId).length === 0),
      )
    ) {
      reasons.push("valid_model_binding");
    }
  }

  const semanticReview = rubricSet.has("single_agent")
    ? proposal.agents.filter((a) => a.kind === "NEW").length !== 1
    : false;
  if (semanticReview) {
    reasons.push("single_agent");
  }

  if (reasons.length === 0) {
    return { score: 2, reasons: [], requiresHumanReview: false };
  }
  if (reasons.length === 1) {
    return { score: 1, reasons, requiresHumanReview: false };
  }
  return { score: 0, reasons, requiresHumanReview: true };
}

const FACT_CHECK_INSTRUCTION_RE =
  /fact[\s-]?check|factcheck|verify|validation|accuracy|review recommendation/i;

function agentRefOnNode(
  proposal: BuilderProposalV1,
  nodeKey: string,
): string | undefined {
  const node = proposal.workflow.nodes.find((n) => n.key === nodeKey);
  if (node === undefined || node.type !== "AGENT") {
    return undefined;
  }
  return node.agentRef;
}

function newAgentInstructions(
  proposal: BuilderProposalV1,
  ref: string,
): string | undefined {
  const spec = proposal.agents.find((a) => a.ref === ref);
  return spec?.kind === "NEW" ? spec.instructions : undefined;
}

function agentExecutionOrder(proposal: BuilderProposalV1): string[] {
  const agentNodes = proposal.workflow.nodes
    .filter((n) => n.type === "AGENT")
    .map((n) => n.key);
  const edges = proposal.workflow.edges ?? [];
  const incoming = new Map<string, number>();
  for (const key of agentNodes) {
    incoming.set(key, 0);
  }
  for (const e of edges) {
    if (incoming.has(e.to)) {
      incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
    }
  }
  const queue = agentNodes.filter((k) => (incoming.get(k) ?? 0) === 0);
  const order: string[] = [];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const key = queue.shift()!;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);
    order.push(key);
    for (const e of edges) {
      if (e.from === key && incoming.has(e.to)) {
        incoming.set(e.to, (incoming.get(e.to) ?? 0) - 1);
        if ((incoming.get(e.to) ?? 0) <= 0) {
          queue.push(e.to);
        }
      }
    }
  }
  return order;
}

export function scoreLiveRefinement(
  base: BuilderProposalV1,
  refined: BuilderProposalV1,
  changes: BuilderProposalChangesetV1 | undefined,
  expectations: Record<string, unknown> | undefined,
  intentRubric?: readonly string[],
): { score: 0 | 1 | 2; reasons: string[]; requiresHumanReview: boolean } {
  const reasons: string[] = [];
  const rubric = new Set(intentRubric ?? []);
  const baseNew = base.agents.filter((a) => a.kind === "NEW");
  const refinedNew = refined.agents.filter((a) => a.kind === "NEW");
  const baseRefs = new Set(base.agents.map((a) => a.ref));
  const newlyAdded = refinedNew.filter((a) => !baseRefs.has(a.ref));

  if (rubric.has("stable_refs")) {
    for (const agent of base.agents) {
      const still = refined.agents.find((a) => a.ref === agent.ref);
      if (still === undefined || still.kind !== agent.kind) {
        reasons.push("stable_refs");
        break;
      }
    }
  }

  const summarizerRef = baseNew[0]?.ref;
  if (
    expectations?.preserveSummarizerInstructions === true &&
    summarizerRef !== undefined
  ) {
    const before = newAgentInstructions(base, summarizerRef) ?? "";
    const after = newAgentInstructions(refined, summarizerRef) ?? "";
    if (before.length > 0 && after.length > 0 && before !== after) {
      reasons.push("summarizer_instructions_drift");
    }
  }

  const minAdded =
    typeof expectations?.minAddedAgents === "number"
      ? expectations.minAddedAgents
      : undefined;
  const addedByCount = refinedNew.length - baseNew.length;
  const addedByChangeset = changes?.addedAgents.length ?? 0;
  const addedAgentsSatisfied =
    minAdded === undefined ||
    addedByCount >= minAdded ||
    addedByChangeset >= minAdded;
  if (!addedAgentsSatisfied) {
    reasons.push("missing_added_agent");
  }

  const requireFactCheck =
    expectations?.requireFactCheckSemantics === true ||
    rubric.has("fact_check_after_summarizer");

  let factCheckAgentRef: string | undefined;
  for (const agent of newlyAdded) {
    const text = agent.kind === "NEW" ? agent.instructions : "";
    if (FACT_CHECK_INSTRUCTION_RE.test(text)) {
      factCheckAgentRef = agent.ref;
      break;
    }
  }
  if (factCheckAgentRef === undefined && newlyAdded.length > 0) {
    for (const agent of newlyAdded) {
      const text = agent.kind === "NEW" ? agent.instructions : "";
      if (text.trim().length > 0) {
        factCheckAgentRef = agent.ref;
        break;
      }
    }
  }

  if (requireFactCheck) {
    if (newlyAdded.length === 0) {
      reasons.push("missing_added_agent");
    } else {
      const semanticHit = newlyAdded.some(
        (a) =>
          a.kind === "NEW" && FACT_CHECK_INSTRUCTION_RE.test(a.instructions),
      );
      if (!semanticHit) {
        reasons.push("fact_check_semantics");
      }
    }
  }

  const order = agentExecutionOrder(refined);
  const summarizerNodeIndex =
    summarizerRef === undefined
      ? -1
      : order.findIndex(
          (key) => agentRefOnNode(refined, key) === summarizerRef,
        );
  const factCheckNodeIndex =
    factCheckAgentRef === undefined
      ? -1
      : order.findIndex(
          (key) => agentRefOnNode(refined, key) === factCheckAgentRef,
        );

  if (
    requireFactCheck &&
    summarizerNodeIndex >= 0 &&
    factCheckNodeIndex >= 0 &&
    factCheckNodeIndex <= summarizerNodeIndex
  ) {
    reasons.push("ordered_dependencies");
  }
  if (
    requireFactCheck &&
    newlyAdded.length > 0 &&
    factCheckAgentRef !== undefined &&
    factCheckNodeIndex < 0
  ) {
    reasons.push("fact_check_not_connected");
  }

  if (reasons.length === 0) {
    return { score: 2, reasons: [], requiresHumanReview: false };
  }
  if (reasons.length <= 1) {
    return {
      score: 1,
      reasons,
      requiresHumanReview:
        reasons.includes("fact_check_semantics") ||
        reasons.includes("fact_check_not_connected"),
    };
  }
  return { score: 0, reasons, requiresHumanReview: true };
}

export type M20_7OverallStatus =
  "PASS" | "PARTIAL" | "FAIL" | "ERROR" | "NOT_RUN" | "BLOCKED_PREREQUISITE";

export function deriveM20_7OverallStatus(
  results: readonly Pick<M20_6ScenarioResult, "status">[],
  options: {
    readonly liveProviderCalls: boolean;
    readonly allScenariosExecuted: boolean;
  },
): M20_7OverallStatus {
  if (!options.allScenariosExecuted || results.length === 0) {
    return "NOT_RUN";
  }
  if (results.some((r) => r.status === "ERROR")) {
    return "ERROR";
  }
  if (results.some((r) => r.status === "FAIL")) {
    return "FAIL";
  }
  if (results.every((r) => r.status === "PASS")) {
    return options.liveProviderCalls ? "PASS" : "FAIL";
  }
  return "PARTIAL";
}

export function liveAcceptanceShouldExitNonZero(
  overallStatus: string,
  options: {
    readonly liveExecuteAttempted: boolean;
    readonly allScenariosExecuted: boolean;
  },
): boolean {
  if (!options.liveExecuteAttempted || !options.allScenariosExecuted) {
    return false;
  }
  return (
    overallStatus === "FAIL" ||
    overallStatus === "ERROR" ||
    overallStatus === "PARTIAL"
  );
}

export function deriveScenarioStatus(
  structural: 0 | 1 | 2,
  intent: 0 | 1 | 2,
  refinement?: 0 | 1 | 2,
): M20_6ScenarioResult["status"] {
  if (structural === 0 || intent === 0) {
    return "FAIL";
  }
  if (refinement === 0) {
    return "FAIL";
  }
  if (
    structural === 2 &&
    intent === 2 &&
    (refinement === undefined || refinement === 2)
  ) {
    return "PASS";
  }
  return "PARTIAL";
}

export function officialEndpointForProvider(
  provider: "OPENAI" | "GOOGLE_GEMINI" | "ANTHROPIC",
): string {
  if (provider === "OPENAI") {
    return M20_7_OFFICIAL_ENDPOINTS.OPENAI;
  }
  if (provider === "GOOGLE_GEMINI") {
    return M20_7_OFFICIAL_ENDPOINTS.GOOGLE_GEMINI;
  }
  return M20_7_OFFICIAL_ENDPOINTS.ANTHROPIC;
}
