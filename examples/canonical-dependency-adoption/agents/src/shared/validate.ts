import type {
  AdoptionDisposition,
  AnalysisConfidence,
  AnalysisCriterionV1,
  AnalysisOutputV1,
  AnalysisRecommendationV1,
  CriterionStatus,
  DependencyReviewRequestV1,
  NpmDownloadsEvidenceV1,
  NpmPackageEvidenceV1,
  ResearchEvidenceV1,
  ResearchModelSynthesisV1,
  ResearchOutputV1,
  WorkflowInputV1,
} from "./contracts.js";
import { EXAMPLE_SCHEMA_VERSION } from "./contracts.js";
import { CanonicalAgentError } from "./errors.js";
import { parseJsonObject, parseStringArray } from "./json.js";

const DISPOSITIONS = new Set<AdoptionDisposition>([
  "ADOPT",
  "PILOT",
  "DO_NOT_ADOPT",
  "NEEDS_REVIEW",
]);

const CONFIDENCE_LEVELS = new Set<AnalysisConfidence>([
  "HIGH",
  "MEDIUM",
  "LOW",
]);

const CRITERION_STATUSES = new Set<CriterionStatus>(["PASS", "REVIEW", "FAIL"]);

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new CanonicalAgentError(`${field} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CanonicalAgentError(`${field} must be non-empty.`);
  }
  return trimmed;
}

function parseRequest(value: unknown): DependencyReviewRequestV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CanonicalAgentError("request must be an object.");
  }
  const record = value as Record<string, unknown>;
  const constraintsRaw = record.constraints;
  if (!Array.isArray(constraintsRaw)) {
    throw new CanonicalAgentError("request.constraints must be an array.");
  }
  const constraints = constraintsRaw.map((entry, index) =>
    requireNonEmptyString(entry, `request.constraints[${index}]`),
  );

  return {
    requestId: requireNonEmptyString(record.requestId, "request.requestId"),
    packageName: requireNonEmptyString(
      record.packageName,
      "request.packageName",
    ),
    useCase: requireNonEmptyString(record.useCase, "request.useCase"),
    constraints,
  };
}

export function parseWorkflowInputV1(input: unknown): WorkflowInputV1 {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new CanonicalAgentError("Workflow input must be a JSON object.");
  }
  const record = input as Record<string, unknown>;
  if (record.schemaVersion !== EXAMPLE_SCHEMA_VERSION) {
    throw new CanonicalAgentError('schemaVersion must be "1".');
  }
  return {
    schemaVersion: EXAMPLE_SCHEMA_VERSION,
    request: parseRequest(record.request),
  };
}

export function parseNpmPackageEvidence(value: unknown): NpmPackageEvidenceV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CanonicalAgentError(
      "npm_package_metadata returned an invalid object.",
    );
  }
  const record = value as Record<string, unknown>;
  const license =
    typeof record.license === "string" && record.license.trim().length > 0
      ? record.license.trim()
      : undefined;
  const repositoryUrl =
    typeof record.repositoryUrl === "string" &&
    record.repositoryUrl.trim().length > 0
      ? record.repositoryUrl.trim()
      : undefined;
  const modifiedAt =
    typeof record.modifiedAt === "string" && record.modifiedAt.trim().length > 0
      ? record.modifiedAt.trim()
      : undefined;
  const deprecated =
    typeof record.deprecated === "string" && record.deprecated.trim().length > 0
      ? record.deprecated.trim()
      : undefined;
  const maintainersCount =
    typeof record.maintainersCount === "number" &&
    Number.isInteger(record.maintainersCount) &&
    record.maintainersCount >= 0
      ? record.maintainersCount
      : undefined;

  return {
    name: requireNonEmptyString(record.name, "npmPackage.name"),
    latestVersion: requireNonEmptyString(
      record.latestVersion,
      "npmPackage.latestVersion",
    ),
    ...(license !== undefined ? { license } : {}),
    ...(repositoryUrl !== undefined ? { repositoryUrl } : {}),
    ...(modifiedAt !== undefined ? { modifiedAt } : {}),
    ...(deprecated !== undefined ? { deprecated } : {}),
    ...(maintainersCount !== undefined ? { maintainersCount } : {}),
  };
}

export function parseNpmDownloadsEvidence(
  value: unknown,
): NpmDownloadsEvidenceV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CanonicalAgentError("npm_downloads returned an invalid object.");
  }
  const record = value as Record<string, unknown>;
  if (record.period !== "last-month") {
    throw new CanonicalAgentError('npm_downloads period must be "last-month".');
  }
  if (
    typeof record.downloads !== "number" ||
    !Number.isFinite(record.downloads) ||
    record.downloads < 0
  ) {
    throw new CanonicalAgentError(
      "npm_downloads.downloads must be a non-negative number.",
    );
  }
  return {
    period: "last-month",
    downloads: Math.trunc(record.downloads),
    start: requireNonEmptyString(record.start, "npmDownloads.start"),
    end: requireNonEmptyString(record.end, "npmDownloads.end"),
  };
}

export function parseResearchModelSynthesis(
  text: string,
): ResearchModelSynthesisV1 {
  const record = parseJsonObject(text, "Research model output");
  const findings = parseStringArray(record.findings, "findings");
  const warnings = parseStringArray(record.warnings, "warnings");
  return { findings, warnings };
}

function parseCriterion(value: unknown, index: number): AnalysisCriterionV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CanonicalAgentError(
      `analysis.criteria[${index}] must be an object.`,
    );
  }
  const record = value as Record<string, unknown>;
  const statusRaw = requireNonEmptyString(
    record.status,
    `analysis.criteria[${index}].status`,
  );
  if (!CRITERION_STATUSES.has(statusRaw as CriterionStatus)) {
    throw new CanonicalAgentError(
      `analysis.criteria[${index}].status is invalid.`,
    );
  }
  return {
    criterion: requireNonEmptyString(
      record.criterion,
      `analysis.criteria[${index}].criterion`,
    ),
    status: statusRaw as CriterionStatus,
    rationale: requireNonEmptyString(
      record.rationale,
      `analysis.criteria[${index}].rationale`,
    ),
    evidenceRefs: parseStringArray(
      record.evidenceRefs,
      `analysis.criteria[${index}].evidenceRefs`,
    ),
  };
}

export function parseAnalysisRecommendation(
  text: string,
): AnalysisRecommendationV1 {
  const record = parseJsonObject(text, "Analysis model output");
  const dispositionRaw = requireNonEmptyString(
    record.disposition,
    "disposition",
  );
  if (!DISPOSITIONS.has(dispositionRaw as AdoptionDisposition)) {
    throw new CanonicalAgentError("analysis.disposition is invalid.");
  }
  const confidenceRaw = requireNonEmptyString(record.confidence, "confidence");
  if (!CONFIDENCE_LEVELS.has(confidenceRaw as AnalysisConfidence)) {
    throw new CanonicalAgentError("analysis.confidence is invalid.");
  }
  if (!Array.isArray(record.criteria)) {
    throw new CanonicalAgentError("analysis.criteria must be an array.");
  }
  const criteria = record.criteria.map((entry, index) =>
    parseCriterion(entry, index),
  );

  return {
    disposition: dispositionRaw as AdoptionDisposition,
    confidence: confidenceRaw as AnalysisConfidence,
    summary: requireNonEmptyString(record.summary, "summary"),
    criteria,
    risks: parseStringArray(record.risks, "risks"),
    openQuestions: parseStringArray(record.openQuestions, "openQuestions"),
  };
}

function parseResearchEvidence(value: unknown): ResearchEvidenceV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CanonicalAgentError("research must be an object.");
  }
  const record = value as Record<string, unknown>;
  const external = record.externalEvidence;
  if (
    external === null ||
    typeof external !== "object" ||
    Array.isArray(external)
  ) {
    throw new CanonicalAgentError(
      "research.externalEvidence must be an object.",
    );
  }
  const externalRecord = external as Record<string, unknown>;

  const policyEvidenceRaw = record.policyEvidence;
  if (!Array.isArray(policyEvidenceRaw)) {
    throw new CanonicalAgentError("research.policyEvidence must be an array.");
  }

  const policyEvidence = policyEvidenceRaw.map((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new CanonicalAgentError(
        `research.policyEvidence[${index}] must be an object.`,
      );
    }
    const item = entry as Record<string, unknown>;
    const normalized = {
      knowledgeChunkId: requireNonEmptyString(
        item.knowledgeChunkId,
        `research.policyEvidence[${index}].knowledgeChunkId`,
      ),
      knowledgeSourceId: requireNonEmptyString(
        item.knowledgeSourceId,
        `research.policyEvidence[${index}].knowledgeSourceId`,
      ),
      score:
        typeof item.score === "number" && Number.isFinite(item.score)
          ? item.score
          : (() => {
              throw new CanonicalAgentError(
                `research.policyEvidence[${index}].score must be a number.`,
              );
            })(),
      excerpt: requireNonEmptyString(
        item.excerpt,
        `research.policyEvidence[${index}].excerpt`,
      ),
    };
    if (typeof item.heading === "string" && item.heading.trim().length > 0) {
      return { ...normalized, heading: item.heading.trim() };
    }
    return normalized;
  });

  const findings = parseStringArray(record.findings, "research.findings");
  const warnings = parseStringArray(record.warnings, "research.warnings");

  return {
    packageName: requireNonEmptyString(
      record.packageName,
      "research.packageName",
    ),
    policyEvidence,
    externalEvidence: {
      npmPackage: parseNpmPackageEvidence(externalRecord.npmPackage),
      npmDownloads: parseNpmDownloadsEvidence(externalRecord.npmDownloads),
    },
    findings,
    warnings,
  };
}

export function parseResearchOutputV1(input: unknown): ResearchOutputV1 {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new CanonicalAgentError("Research input must be a JSON object.");
  }
  const record = input as Record<string, unknown>;
  if (record.schemaVersion !== EXAMPLE_SCHEMA_VERSION) {
    throw new CanonicalAgentError('schemaVersion must be "1".');
  }
  return {
    schemaVersion: EXAMPLE_SCHEMA_VERSION,
    request: parseRequest(record.request),
    research: parseResearchEvidence(record.research),
  };
}

export function parseAnalysisOutputV1(input: unknown): AnalysisOutputV1 {
  const researchOutput = parseResearchOutputV1(input);
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new CanonicalAgentError("Analysis input must be a JSON object.");
  }
  const record = input as Record<string, unknown>;
  const analysisRaw = record.analysis;
  if (
    analysisRaw === null ||
    typeof analysisRaw !== "object" ||
    Array.isArray(analysisRaw)
  ) {
    throw new CanonicalAgentError("analysis must be an object.");
  }
  const analysisRecord = analysisRaw as Record<string, unknown>;
  const dispositionRaw = requireNonEmptyString(
    analysisRecord.disposition,
    "disposition",
  );
  if (!DISPOSITIONS.has(dispositionRaw as AdoptionDisposition)) {
    throw new CanonicalAgentError("analysis.disposition is invalid.");
  }
  const confidenceRaw = requireNonEmptyString(
    analysisRecord.confidence,
    "confidence",
  );
  if (!CONFIDENCE_LEVELS.has(confidenceRaw as AnalysisConfidence)) {
    throw new CanonicalAgentError("analysis.confidence is invalid.");
  }
  if (!Array.isArray(analysisRecord.criteria)) {
    throw new CanonicalAgentError("analysis.criteria must be an array.");
  }
  const criteria = analysisRecord.criteria.map((entry, index) =>
    parseCriterion(entry, index),
  );

  return {
    schemaVersion: EXAMPLE_SCHEMA_VERSION,
    request: researchOutput.request,
    research: researchOutput.research,
    analysis: {
      disposition: dispositionRaw as AdoptionDisposition,
      confidence: confidenceRaw as AnalysisConfidence,
      summary: requireNonEmptyString(
        analysisRecord.summary,
        "analysis.summary",
      ),
      criteria,
      risks: parseStringArray(analysisRecord.risks, "analysis.risks"),
      openQuestions: parseStringArray(
        analysisRecord.openQuestions,
        "analysis.openQuestions",
      ),
    },
  };
}
