export const EXAMPLE_SCHEMA_VERSION = "1" as const;

export type ExampleSchemaVersion = typeof EXAMPLE_SCHEMA_VERSION;

export type AdoptionDisposition =
  "ADOPT" | "PILOT" | "DO_NOT_ADOPT" | "NEEDS_REVIEW";

export type AnalysisConfidence = "HIGH" | "MEDIUM" | "LOW";

export type CriterionStatus = "PASS" | "REVIEW" | "FAIL";

export interface DependencyReviewRequestV1 {
  readonly requestId: string;
  readonly packageName: string;
  readonly useCase: string;
  readonly constraints: readonly string[];
}

export interface WorkflowInputV1 {
  readonly schemaVersion: ExampleSchemaVersion;
  readonly request: DependencyReviewRequestV1;
}

export interface PolicyEvidenceItemV1 {
  readonly knowledgeChunkId: string;
  readonly knowledgeSourceId: string;
  readonly score: number;
  readonly heading?: string;
  readonly excerpt: string;
}

export interface NpmPackageEvidenceV1 {
  readonly name: string;
  readonly latestVersion: string;
  readonly license?: string;
  readonly repositoryUrl?: string;
  readonly modifiedAt?: string;
  readonly deprecated?: string;
  readonly maintainersCount?: number;
}

export interface NpmDownloadsEvidenceV1 {
  readonly period: "last-month";
  readonly downloads: number;
  readonly start: string;
  readonly end: string;
}

export interface ResearchEvidenceV1 {
  readonly packageName: string;
  readonly policyEvidence: readonly PolicyEvidenceItemV1[];
  readonly externalEvidence: {
    readonly npmPackage: NpmPackageEvidenceV1;
    readonly npmDownloads: NpmDownloadsEvidenceV1;
  };
  readonly findings: readonly string[];
  readonly warnings: readonly string[];
}

export interface ResearchOutputV1 {
  readonly schemaVersion: ExampleSchemaVersion;
  readonly request: DependencyReviewRequestV1;
  readonly research: ResearchEvidenceV1;
}

export interface AnalysisCriterionV1 {
  readonly criterion: string;
  readonly status: CriterionStatus;
  readonly rationale: string;
  readonly evidenceRefs: readonly string[];
}

export interface AnalysisRecommendationV1 {
  readonly disposition: AdoptionDisposition;
  readonly confidence: AnalysisConfidence;
  readonly summary: string;
  readonly criteria: readonly AnalysisCriterionV1[];
  readonly risks: readonly string[];
  readonly openQuestions: readonly string[];
}

export interface AnalysisOutputV1 {
  readonly schemaVersion: ExampleSchemaVersion;
  readonly request: DependencyReviewRequestV1;
  readonly research: ResearchEvidenceV1;
  readonly analysis: AnalysisRecommendationV1;
}

export interface ReportOutputV1 {
  readonly schemaVersion: ExampleSchemaVersion;
  readonly requestId: string;
  readonly disposition: AdoptionDisposition;
  readonly summary: string;
  readonly artifact: {
    readonly type: "artifact";
    readonly artifactId: string;
  };
}

export interface ResearchModelSynthesisV1 {
  readonly findings: readonly string[];
  readonly warnings: readonly string[];
}
