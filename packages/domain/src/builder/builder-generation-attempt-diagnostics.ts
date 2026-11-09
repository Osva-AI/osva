import type { ModelFinishReason } from "@osva-ai/contracts";

import type { BuilderIssueCode, BuilderIssueV1 } from "./builder-issue.js";
import type {
  BuilderGenerationErrorCode,
  BuilderGenerationFailureV1,
  BuilderGenerationMeasuredUsageV1,
} from "./builder-natural-language-generation-types.js";

const ALLOWED_ISSUE_CODES = new Set<BuilderIssueCode>([
  "INVALID_PROPOSAL_SCHEMA",
  "INVALID_GRAPH_TOPOLOGY",
  "UNKNOWN_AGENT_REFERENCE",
  "MISSING_MODEL_SELECTION",
  "MISSING_TOOL_SELECTION",
  "UNAUTHORIZED_OR_FOREIGN_RESOURCE",
  "UNSUPPORTED_NODE_CONFIGURATION",
  "MISSING_AGENT_VERSION_RESOLUTION",
  "INVALID_COMPILED_AGENT_MANIFEST",
  "INVALID_COMPILED_WORKFLOW_DEFINITION",
  "DUPLICATE_AGENT_REFERENCE",
  "DUPLICATE_NODE_KEY",
]);

export type BuilderGenerationValidationStage =
  | "provider_invocation"
  | "json_output"
  | "proposal_parse"
  | "catalog_visibility"
  | "pre_publication_compile";

/** Bounded compile issue for operator evidence (no unbounded compiler prose). */
export interface BuilderGenerationCompileIssueEvidenceV1 {
  readonly code: BuilderIssueCode;
  readonly severity: "error" | "warning";
  readonly locationKind?: string;
  readonly nodeKey?: string;
  readonly agentRef?: string;
  readonly edgeFrom?: string;
  readonly edgeTo?: string;
  readonly resourceKind?: string;
  readonly messagePreview: string;
}

export interface BuilderGenerationAttemptDiagnosticV1 {
  readonly providerAttempt: number;
  readonly afterRepair: boolean;
  readonly validationStage: BuilderGenerationValidationStage;
  readonly errorCode: BuilderGenerationErrorCode;
  readonly detailMessages?: readonly string[];
  readonly compileIssues?: readonly BuilderGenerationCompileIssueEvidenceV1[];
  readonly modelFinishReason?: ModelFinishReason;
  readonly repairAttempted: boolean;
  readonly measuredUsage?: BuilderGenerationMeasuredUsageV1;
}

export function validationStageForErrorCode(
  code: BuilderGenerationErrorCode,
): BuilderGenerationValidationStage {
  if (code === "INVALID_JSON_OUTPUT") {
    return "json_output";
  }
  if (code === "INVALID_BUILDER_PROPOSAL") {
    return "proposal_parse";
  }
  if (code === "CATALOG_PROMPT_VISIBILITY_VIOLATION") {
    return "catalog_visibility";
  }
  if (
    code === "INVALID_COMPILED_PROPOSAL" ||
    code === "UNAUTHORIZED_OR_UNKNOWN_RESOURCE_REFERENCE"
  ) {
    return "pre_publication_compile";
  }
  if (
    code === "PROVIDER_ERROR" ||
    code === "PROVIDER_UNAVAILABLE" ||
    code === "PROVIDER_TIMEOUT"
  ) {
    return "provider_invocation";
  }
  return "proposal_parse";
}

function sanitizeIssueLocation(
  issue: BuilderIssueV1,
): Pick<
  BuilderGenerationCompileIssueEvidenceV1,
  | "locationKind"
  | "nodeKey"
  | "agentRef"
  | "edgeFrom"
  | "edgeTo"
  | "resourceKind"
> {
  const location = issue.location;
  if (location === undefined) {
    return {};
  }

  if (location.kind === "workflow_node") {
    return {
      locationKind: location.kind,
      nodeKey: location.nodeKey.slice(0, 128),
    };
  }
  if (location.kind === "workflow_edge") {
    return {
      locationKind: location.kind,
      edgeFrom: location.from.slice(0, 128),
      edgeTo: location.to.slice(0, 128),
    };
  }
  if (location.kind === "agent_spec") {
    return {
      locationKind: location.kind,
      agentRef: location.ref?.slice(0, 140),
    };
  }
  if (location.kind === "resource") {
    return {
      locationKind: location.kind,
      resourceKind: location.resource.kind,
    };
  }
  return { locationKind: location.kind };
}

export function sanitizeCompileIssuesForEvidence(
  issues:
    | readonly BuilderIssueV1[]
    | readonly BuilderGenerationCompileIssueEvidenceV1[]
    | undefined,
): readonly BuilderGenerationCompileIssueEvidenceV1[] | undefined {
  if (issues === undefined || issues.length === 0) {
    return undefined;
  }

  const sanitized: BuilderGenerationCompileIssueEvidenceV1[] = [];
  for (const issue of issues.slice(0, 12)) {
    if (!ALLOWED_ISSUE_CODES.has(issue.code)) {
      continue;
    }

    const preview = (issue as BuilderGenerationCompileIssueEvidenceV1)
      .messagePreview;
    if (typeof preview === "string" && preview.length > 0) {
      sanitized.push({
        code: issue.code,
        severity: issue.severity,
        locationKind: (issue as BuilderGenerationCompileIssueEvidenceV1)
          .locationKind,
        nodeKey: (issue as BuilderGenerationCompileIssueEvidenceV1).nodeKey,
        agentRef: (issue as BuilderGenerationCompileIssueEvidenceV1).agentRef,
        edgeFrom: (issue as BuilderGenerationCompileIssueEvidenceV1).edgeFrom,
        edgeTo: (issue as BuilderGenerationCompileIssueEvidenceV1).edgeTo,
        resourceKind: (issue as BuilderGenerationCompileIssueEvidenceV1)
          .resourceKind,
        messagePreview: preview.slice(0, 160),
      });
      continue;
    }

    const full = issue as BuilderIssueV1;
    if (typeof full.message !== "string") {
      continue;
    }

    sanitized.push({
      code: full.code,
      severity: full.severity,
      ...sanitizeIssueLocation(full),
      messagePreview: full.message.replace(/\s+/g, " ").trim().slice(0, 160),
    });
  }

  return sanitized.length > 0 ? sanitized : undefined;
}

export function buildGenerationAttemptDiagnostic(input: {
  readonly providerAttempt: number;
  readonly afterRepair: boolean;
  readonly repairAttempted: boolean;
  readonly failure: BuilderGenerationFailureV1;
  readonly modelFinishReason?: ModelFinishReason;
  readonly measuredUsage?: BuilderGenerationMeasuredUsageV1;
}): BuilderGenerationAttemptDiagnosticV1 {
  return {
    providerAttempt: input.providerAttempt,
    afterRepair: input.afterRepair,
    validationStage: validationStageForErrorCode(input.failure.errorCode),
    errorCode: input.failure.errorCode,
    detailMessages: input.failure.detailMessages?.slice(0, 8),
    compileIssues: sanitizeCompileIssuesForEvidence(
      input.failure.compileIssues,
    ),
    modelFinishReason: input.modelFinishReason,
    repairAttempted: input.repairAttempted,
    measuredUsage: input.measuredUsage,
  };
}
