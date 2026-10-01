export const validWorkflowInput = {
  schemaVersion: "1",
  request: {
    requestId: "req-canonical-demo-001",
    packageName: "zod",
    useCase:
      "Runtime validation for public API request bodies in a tier-1 service.",
    constraints: [
      "Must use a permissive license approved for SaaS distribution.",
      "Prefer packages with active maintenance in the last 12 months.",
    ],
  },
} as const;

export const validResearchOutput = {
  schemaVersion: "1",
  request: { ...validWorkflowInput.request },
  research: {
    packageName: "zod",
    policyEvidence: [
      {
        knowledgeChunkId: "chunk-policy-license-1",
        knowledgeSourceId: "source-engineering-policy",
        score: 0.91,
        heading: "License requirements",
        excerpt:
          "Preferred licenses include MIT and Apache-2.0; unknown license requires NEEDS_REVIEW.",
      },
    ],
    externalEvidence: {
      npmPackage: {
        name: "zod",
        latestVersion: "4.6.5",
        license: "MIT",
        repositoryUrl: "https://github.com/colinhacks/zod",
        modifiedAt: "2026-03-01T00:00:00.000Z",
        maintainersCount: 2,
      },
      npmDownloads: {
        period: "last-month",
        downloads: 45_000_000,
        start: "2026-02-01",
        end: "2026-02-28",
      },
    },
    findings: [
      "Policy chunks favor permissive licenses; npm reports MIT.",
      "Download volume indicates broad community adoption.",
    ],
    warnings: [
      "Verify major-version upgrade path against existing v3 usage in legacy services.",
    ],
  },
} as const;

export const validAnalysisOutput = {
  schemaVersion: "1",
  request: { ...validWorkflowInput.request },
  research: validResearchOutput.research,
  analysis: {
    disposition: "PILOT",
    confidence: "MEDIUM",
    summary:
      "Evidence supports a time-boxed pilot for tier-1 validation with license and maintenance checks passing; confirm v4 migration plan.",
    criteria: [
      {
        criterion: "license-compatibility",
        status: "PASS",
        rationale: "MIT license aligns with ExampleCo preferred list.",
        evidenceRefs: ["chunk-policy-license-1", "npm:license"],
      },
      {
        criterion: "maintenance-health",
        status: "REVIEW",
        rationale:
          "Recent releases exist; major version adoption needs explicit migration planning.",
        evidenceRefs: ["npm:modifiedAt"],
      },
    ],
    risks: [
      "Major version drift across services could fragment validation behavior.",
    ],
    openQuestions: [
      "Does the requesting team already standardize on zod v3 or v4?",
    ],
  },
} as const;

export const validReportOutput = {
  schemaVersion: "1",
  requestId: validWorkflowInput.request.requestId,
  disposition: "PILOT",
  summary:
    "Pilot approved pending migration checklist; full markdown report stored as artifact.",
  artifact: {
    type: "artifact",
    artifactId: "artifact-canonical-report-001",
  },
} as const;
