import { randomUUID } from "node:crypto";

import type { BuilderGenerationAttemptDiagnosticV1 } from "@osva/domain/builder";
import type {
  BuilderProposalV1,
  WorkspaceBuilderCapabilityCatalogV1,
} from "@osva/domain/builder";
import {
  buildBuilderCatalogIndex,
  compileBuilderProposalPrePublication,
  parseBuilderProposalV1,
} from "@osva/domain/builder";

import {
  ANTHROPIC_REFINEMENT_AGENT_NODE_KEY,
  ANTHROPIC_REFINEMENT_AGENT_REF,
  ANTHROPIC_REFINEMENT_SUMMARIZER_INSTRUCTIONS,
  ANTHROPIC_REFINEMENT_WORKFLOW_KEY,
} from "./m20-7-anthropic-refinement-fixture.js";
import {
  classifyAnthropicGenerationProbeOutcome,
  providerAdapterAcceptedResponse,
} from "./m20-7-anthropic-generation-probe-eval.js";
import {
  parseLiveBuilderGenerationBody,
  probeArtifactBuilderErrorCode,
  sanitizeBuilderGenerationFailure,
  type LiveBuilderGenerationResponseShape,
  type M20_7SanitizedBuilderGenerationFailure,
  type M20_7SanitizedBuilderProviderDiagnostic,
} from "./m20-7-live-eval.js";

export const M20_7_ANTHROPIC_REFINEMENT_PROBE_ARTIFACT =
  "anthropic-refinement-probe.json";
export const M20_7_ANTHROPIC_GENERATION_PROBE_ARTIFACT =
  "anthropic-generation-probe.json";

export const ANTHROPIC_REFINEMENT_UNCOMMITTED_CODE_NOTE =
  "sourceCommit identifies HEAD only. Uncommitted M20.7.4 Anthropic records IR and refinement-harness changes in the working tree are part of the tested code.";

export type M20_7AnthropicRefinementProbeOutcome =
  | "PROBE_DRY_RUN"
  | "PROBE_BLOCKED"
  | "BUILDER_REFINEMENT_PASS"
  | "BUILDER_REFINEMENT_FAIL"
  | "PROVIDER_HTTP_ERROR"
  | "TRANSPORT_ERROR"
  | "ADAPTER_ERROR"
  | "BUILDER_VALIDATION_ERROR";

export interface AnthropicApprovalRefinementScore {
  readonly score: 0 | 1 | 2;
  readonly reasons: readonly string[];
  readonly requiresHumanReview: boolean;
  readonly compileOk: boolean;
}

export interface M20_7AnthropicRefinementProbeArtifactV1 {
  readonly schemaVersion: "1";
  readonly harnessVersion: "m20-7.4";
  readonly runId: string;
  readonly mode: "dry_run" | "execute";
  readonly sourceCommit?: string;
  readonly blockedReason?: string;
  readonly outcome: M20_7AnthropicRefinementProbeOutcome;
  readonly provider: "ANTHROPIC";
  readonly modelId: string;
  readonly structuredOutputWire: "outputConfigJsonSchema";
  readonly recordsEncoding: "anthropic_records_v1";
  readonly isolatedBaseline: "canonical_fixture";
  readonly invocationAttempted: boolean;
  readonly providerAttempts: number;
  readonly repairAttempted: boolean;
  readonly latencyMs?: number;
  readonly httpStatus?: number;
  readonly builderErrorCode?: string;
  readonly providerDiagnostic?: M20_7SanitizedBuilderProviderDiagnostic;
  readonly providerResponseAccepted: boolean;
  readonly builderHttpOk: boolean;
  readonly recordsDecodeAssumedByHttpOk: boolean;
  readonly canonicalValidationOk: boolean;
  readonly compilerValidationOk: boolean;
  readonly requestedModificationApplied: boolean;
  readonly existingNodesPreserved: boolean;
  readonly rubricScore?: 0 | 1 | 2;
  readonly rubricReasons?: readonly string[];
  readonly builderRefinementPass: boolean;
  readonly measuredUsage?: {
    readonly usageMeasured: boolean;
    readonly inputUnits?: number;
    readonly outputUnits?: number;
  };
  readonly modelFinishReason?: string;
  readonly validationStage?: BuilderGenerationAttemptDiagnosticV1["validationStage"];
  readonly compileIssueCodes?: readonly string[];
  readonly attemptDiagnostics?: readonly BuilderGenerationAttemptDiagnosticV1[];
  readonly provenance: {
    readonly sourceCommit?: string;
    readonly workingTreeDirty: boolean;
    readonly uncommittedCodeNote: string;
    readonly generationArtifactRetained: boolean;
    readonly generationArtifactFile: typeof M20_7_ANTHROPIC_GENERATION_PROBE_ARTIFACT;
    readonly isolatedBaseline: "canonical_fixture";
    readonly liveGenerationRerun: false;
  };
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
  "refinementInstruction",
  "currentProposal",
  "rawPrompt",
  "apiKey",
  "authorization",
]);

function countToolBindings(proposal: BuilderProposalV1): number {
  return proposal.agents.reduce((sum, agent) => {
    if (agent.kind !== "NEW") {
      return sum;
    }
    return sum + agent.tools.length;
  }, 0);
}

function newAgentInstructions(
  proposal: BuilderProposalV1,
  ref: string,
): string | undefined {
  const spec = proposal.agents.find((a) => a.ref === ref);
  return spec?.kind === "NEW" ? spec.instructions : undefined;
}

function approvalPrecedesFinalAgent(refined: BuilderProposalV1): boolean {
  const edges = refined.workflow.edges ?? [];
  const approvalKeys = new Set(
    refined.workflow.nodes
      .filter((n) => n.type === "APPROVAL")
      .map((n) => n.key),
  );
  if (approvalKeys.size === 0) {
    return false;
  }
  return edges.some(
    (edge) =>
      approvalKeys.has(edge.from) &&
      edge.to === ANTHROPIC_REFINEMENT_AGENT_NODE_KEY,
  );
}

export function scoreAnthropicApprovalInsertionRefinement(
  base: BuilderProposalV1,
  refined: BuilderProposalV1,
  catalog: WorkspaceBuilderCapabilityCatalogV1,
): AnthropicApprovalRefinementScore {
  const reasons: string[] = [];

  if (refined.workflowRegistry.key !== ANTHROPIC_REFINEMENT_WORKFLOW_KEY) {
    reasons.push("workflow_identity");
  } else if (base.workflowRegistry.key !== refined.workflowRegistry.key) {
    reasons.push("workflow_identity");
  }

  const baseRefs = new Set(base.agents.map((a) => a.ref));
  for (const agent of base.agents) {
    const still = refined.agents.find((a) => a.ref === agent.ref);
    if (still === undefined || still.kind !== agent.kind) {
      reasons.push("stable_refs");
      break;
    }
  }

  const summarizerInstructions = newAgentInstructions(
    refined,
    ANTHROPIC_REFINEMENT_AGENT_REF,
  );
  if (summarizerInstructions !== ANTHROPIC_REFINEMENT_SUMMARIZER_INSTRUCTIONS) {
    reasons.push("summarizer_instructions_drift");
  }

  const originalAgentNode = refined.workflow.nodes.find(
    (n) => n.key === ANTHROPIC_REFINEMENT_AGENT_NODE_KEY,
  );
  if (
    originalAgentNode === undefined ||
    originalAgentNode.type !== "AGENT" ||
    originalAgentNode.agentRef !== ANTHROPIC_REFINEMENT_AGENT_REF
  ) {
    reasons.push("original_agent_node_missing");
  }

  const approvalNodes = refined.workflow.nodes.filter(
    (n) => n.type === "APPROVAL",
  );
  if (approvalNodes.length === 0) {
    reasons.push("missing_approval_node");
  }

  if (!approvalPrecedesFinalAgent(refined)) {
    reasons.push("approval_not_before_final_agent");
  }

  const titleHit = approvalNodes.some(
    (n) => n.type === "APPROVAL" && /review/i.test(n.title),
  );
  if (approvalNodes.length > 0 && !titleHit) {
    reasons.push("approval_title_semantics");
  }

  const extraAgents = refined.agents.filter((a) => !baseRefs.has(a.ref));
  if (extraAgents.length > 0) {
    reasons.push("extra_agents");
  }

  if (countToolBindings(refined) > 0) {
    reasons.push("invented_tools");
  }

  const unexpectedTypes = refined.workflow.nodes.some(
    (n) => n.type !== "AGENT" && n.type !== "APPROVAL",
  );
  if (unexpectedTypes) {
    reasons.push("unexpected_node_types");
  }

  const index = buildBuilderCatalogIndex(catalog);
  const compiled = compileBuilderProposalPrePublication(refined, index);
  const blocking = compiled.issues.filter((i) => i.severity === "error");
  const compileOk = blocking.length === 0;
  if (!compileOk) {
    reasons.push("compile_blocking");
    return {
      score: 0,
      reasons,
      requiresHumanReview: true,
      compileOk,
    };
  }

  if (reasons.length === 0) {
    return {
      score: 2,
      reasons: [],
      requiresHumanReview: false,
      compileOk,
    };
  }
  if (reasons.length === 1) {
    return {
      score: 1,
      reasons,
      requiresHumanReview: false,
      compileOk,
    };
  }
  return {
    score: 0,
    reasons,
    requiresHumanReview: true,
    compileOk,
  };
}

export function classifyAnthropicRefinementProbeOutcome(input: {
  readonly httpStatus: number;
  readonly parsed?: LiveBuilderGenerationResponseShape;
  readonly failure?: M20_7SanitizedBuilderGenerationFailure;
  readonly providerAttempts: number;
  readonly repairAttempted: boolean;
  readonly rubricScore?: 0 | 1 | 2;
  readonly compileOk?: boolean;
  readonly canonicalOk?: boolean;
}): M20_7AnthropicRefinementProbeOutcome {
  if (input.parsed?.ok === true) {
    const pass =
      input.rubricScore === 2 &&
      input.compileOk === true &&
      input.canonicalOk === true &&
      input.repairAttempted !== true &&
      input.providerAttempts === 1;
    return pass ? "BUILDER_REFINEMENT_PASS" : "BUILDER_REFINEMENT_FAIL";
  }

  const generation = classifyAnthropicGenerationProbeOutcome({
    httpStatus: input.httpStatus,
    parsed: input.parsed,
    failure: input.failure,
    providerAttempts: input.providerAttempts,
  });
  if (generation === "BUILDER_GENERATION_PASS") {
    return "BUILDER_REFINEMENT_FAIL";
  }
  if (generation === "PROVIDER_RESPONSE_ACCEPTED") {
    return "BUILDER_VALIDATION_ERROR";
  }
  return generation;
}

export function anthropicRefinementProbeExecuteExitCode(
  outcome: M20_7AnthropicRefinementProbeOutcome,
): number {
  if (outcome === "BUILDER_REFINEMENT_PASS") {
    return 0;
  }
  if (outcome === "PROBE_DRY_RUN" || outcome === "PROBE_BLOCKED") {
    return 0;
  }
  return 1;
}

export function parseProbeRefineResponse(
  httpStatus: number,
  body: unknown,
): {
  readonly parsed: LiveBuilderGenerationResponseShape | undefined;
  readonly candidateProposal: unknown;
} {
  const parsed = parseLiveBuilderGenerationBody(httpStatus, body);
  const candidateProposal =
    typeof body === "object" && body !== null && "candidateProposal" in body
      ? (body as { candidateProposal?: unknown }).candidateProposal
      : undefined;
  return { parsed, candidateProposal };
}

export function parseRefinedCandidateProposal(
  candidateProposal: unknown,
): BuilderProposalV1 | undefined {
  const parsed = parseBuilderProposalV1(candidateProposal);
  return parsed.ok ? parsed.proposal : undefined;
}

export function buildAnthropicRefinementProbeArtifact(input: {
  readonly mode: "dry_run" | "execute";
  readonly modelId: string;
  readonly sourceCommit?: string;
  readonly workingTreeDirty: boolean;
  readonly generationArtifactRetained: boolean;
  readonly blockedReason?: string;
  readonly httpStatus?: number;
  readonly latencyMs?: number;
  readonly parsed?: LiveBuilderGenerationResponseShape;
  readonly rubric?: AnthropicApprovalRefinementScore;
  readonly canonicalOk?: boolean;
  readonly maxProviderInvocations: number;
  readonly maxEstimatedCostUsdMicros?: number;
  readonly maxInputTokensPerAttempt?: number;
  readonly maxOutputTokensPerAttempt?: number;
  readonly estimatedWorstCaseMicroUsd?: number;
  readonly estimatedWorstCaseReason?: string;
  readonly invocationAttempted: boolean;
  readonly notes?: string;
}): M20_7AnthropicRefinementProbeArtifactV1 {
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
  const builderHttpOk = input.parsed?.ok === true;
  const compileOk = input.rubric?.compileOk === true;
  const canonicalOk = input.canonicalOk === true;
  const requestedModificationApplied =
    input.rubric !== undefined &&
    !input.rubric.reasons.includes("missing_approval_node") &&
    !input.rubric.reasons.includes("approval_not_before_final_agent");
  const existingNodesPreserved =
    input.rubric !== undefined &&
    !input.rubric.reasons.includes("original_agent_node_missing") &&
    !input.rubric.reasons.includes("stable_refs") &&
    !input.rubric.reasons.includes("workflow_identity") &&
    !input.rubric.reasons.includes("summarizer_instructions_drift");

  const providerAccepted =
    input.mode === "execute" && input.parsed !== undefined
      ? providerAdapterAcceptedResponse({
          parsed: input.parsed,
          failure,
          providerAttempts,
        })
      : false;

  const finalOutcome: M20_7AnthropicRefinementProbeOutcome =
    input.blockedReason !== undefined
      ? "PROBE_BLOCKED"
      : input.mode === "dry_run"
        ? "PROBE_DRY_RUN"
        : input.parsed === undefined || input.httpStatus === undefined
          ? "ADAPTER_ERROR"
          : classifyAnthropicRefinementProbeOutcome({
              httpStatus: input.httpStatus,
              parsed: input.parsed,
              failure,
              providerAttempts,
              repairAttempted,
              rubricScore: input.rubric?.score,
              compileOk,
              canonicalOk,
            });

  return {
    schemaVersion: "1",
    harnessVersion: "m20-7.4",
    runId: randomUUID(),
    mode: input.mode,
    sourceCommit: input.sourceCommit,
    blockedReason: input.blockedReason,
    outcome: finalOutcome,
    provider: "ANTHROPIC",
    modelId: input.modelId,
    structuredOutputWire: "outputConfigJsonSchema",
    recordsEncoding: "anthropic_records_v1",
    isolatedBaseline: "canonical_fixture",
    invocationAttempted: input.invocationAttempted,
    providerAttempts,
    repairAttempted,
    latencyMs: input.latencyMs,
    httpStatus: input.httpStatus,
    builderErrorCode: probeArtifactBuilderErrorCode(input.parsed, failure),
    providerDiagnostic: failure?.providerDiagnostic,
    providerResponseAccepted: providerAccepted,
    builderHttpOk,
    recordsDecodeAssumedByHttpOk: builderHttpOk,
    canonicalValidationOk: canonicalOk,
    compilerValidationOk: compileOk,
    requestedModificationApplied,
    existingNodesPreserved,
    rubricScore: input.rubric?.score,
    rubricReasons: input.rubric?.reasons,
    builderRefinementPass: finalOutcome === "BUILDER_REFINEMENT_PASS",
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
    provenance: {
      sourceCommit: input.sourceCommit,
      workingTreeDirty: input.workingTreeDirty,
      uncommittedCodeNote: ANTHROPIC_REFINEMENT_UNCOMMITTED_CODE_NOTE,
      generationArtifactRetained: input.generationArtifactRetained,
      generationArtifactFile: M20_7_ANTHROPIC_GENERATION_PROBE_ARTIFACT,
      isolatedBaseline: "canonical_fixture",
      liveGenerationRerun: false,
    },
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

export function assertAnthropicRefinementProbeArtifactSanitized(
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
