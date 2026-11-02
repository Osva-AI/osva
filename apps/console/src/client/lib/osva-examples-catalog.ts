import {
  buildExampleReadmeUrl,
  isAllowedOsvaExamplesUrl,
  OSVA_EXAMPLES_AUDITED_SHA,
  OSVA_EXAMPLES_REPO,
} from "./osva-examples-links";

export type ExampleCategory =
  | "getting-started"
  | "workflow-automation"
  | "operations"
  | "knowledge"
  | "research";

export type ExampleComplexity = "intro" | "intermediate" | "advanced";

export type OsvaVersionTarget = "1.0.0" | "1.1.x";

export interface ExampleVerificationEvidence {
  readonly sourceDocumented: true;
  readonly offlineCiSmoke: boolean;
  /** Only true when explicit live integration evidence exists in osva-examples docs. */
  readonly liveIntegrationVerified: boolean;
}

export interface ExampleConsoleNextStep {
  readonly label: string;
  readonly to: string;
  readonly requiresWrite?: boolean;
}

export interface OsvaExampleCatalogEntry {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: ExampleCategory;
  readonly keywords: readonly string[];
  readonly complexity: ExampleComplexity;
  readonly primitives: readonly string[];
  readonly requirements: readonly string[];
  readonly osvaVersion: OsvaVersionTarget;
  readonly limitations: readonly string[];
  readonly sourcePath: string;
  readonly sourceReadmeUrl: string;
  readonly verification: ExampleVerificationEvidence;
  readonly fixtureBacked: boolean;
  readonly featured?: boolean;
  readonly consoleNextSteps: readonly ExampleConsoleNextStep[];
}

const BASE_VERIFICATION = {
  sourceDocumented: true as const,
  offlineCiSmoke: true,
  liveIntegrationVerified: false,
};

function entry(
  partial: Omit<OsvaExampleCatalogEntry, "sourceReadmeUrl" | "verification"> & {
    verification?: Partial<ExampleVerificationEvidence>;
  },
): OsvaExampleCatalogEntry {
  return {
    ...partial,
    sourceReadmeUrl: buildExampleReadmeUrl(partial.sourcePath),
    verification: {
      ...BASE_VERIFICATION,
      ...partial.verification,
      sourceDocumented: true,
    },
  };
}

export const OSVA_EXAMPLE_CATALOG: readonly OsvaExampleCatalogEntry[] = [
  entry({
    id: "01-minimal-agent",
    title: "Minimal agent run",
    description:
      "Run an existing AgentVersion through the public SDK, poll the attempt with a wall-clock deadline, and inspect the final result— the smallest external OSVA execution loop.",
    category: "getting-started",
    keywords: [
      "agent",
      "run",
      "minimal",
      "execute",
      "poll",
      "sdk",
      "first",
      "start",
      "simple",
    ],
    complexity: "intro",
    primitives: ["Agent", "AgentVersion", "Run", "RunAttempt"],
    requirements: [
      "OSVA OSS 1.0.0 endpoint and API key",
      "Existing executable Agent and AgentVersion IDs",
    ],
    osvaVersion: "1.0.0",
    limitations: [
      "Does not create agents or workflows—requires pre-existing AgentVersion IDs.",
      "Creates a durable Run in your workspace.",
    ],
    sourcePath: "examples/01-minimal-agent",
    fixtureBacked: false,
    featured: true,
    consoleNextSteps: [
      { label: "Open Agent Studio", to: "/agents/new", requiresWrite: true },
      { label: "View agents", to: "/agents" },
      { label: "Getting started", to: "/onboarding" },
    ],
  }),
  entry({
    id: "03-durable-review-workflow",
    title: "Durable review workflow",
    description:
      "AGENT → AGENT → human approval → durable event wait → report agent, ending in a downloadable Markdown artifact using Workflow V3 and public runtime capabilities.",
    category: "workflow-automation",
    keywords: [
      "workflow",
      "approval",
      "human",
      "review",
      "durable",
      "event",
      "wait",
      "artifact",
      "report",
      "gate",
    ],
    complexity: "intermediate",
    primitives: [
      "Workflow V3",
      "APPROVAL",
      "EVENT WAIT",
      "WorkflowEvent",
      "Artifact",
      "REMOTE_HTTP",
    ],
    requirements: [
      "OSVA web, worker, workflow orchestrator, and artifact storage",
      "API key with workflow, approval, event, and artifact permissions",
      "Worker reachability to REMOTE_HTTP runtime URL",
    ],
    osvaVersion: "1.0.0",
    limitations: [
      "Deterministic agents—no paid model required for the default path.",
      "Local REMOTE_HTTP may require documented private-network opt-ins.",
      "Does not delete durable OSVA registry records after the demo.",
    ],
    sourcePath: "examples/03-durable-review-workflow",
    fixtureBacked: false,
    featured: true,
    consoleNextSteps: [
      {
        label: "Open Workflow Builder",
        to: "/workflows/new",
        requiresWrite: true,
      },
      { label: "View workflows", to: "/workflows" },
    ],
  }),
  entry({
    id: "04-seo-worker",
    title: "SEO audit worker",
    description:
      "Inspect a page via MCP, run deterministic SEO checks, pause for human approval, then publish a prioritized Markdown SEO audit artifact.",
    category: "workflow-automation",
    keywords: [
      "seo",
      "audit",
      "page",
      "inspect",
      "marketing",
      "search",
      "optimization",
      "website",
      "technical",
    ],
    complexity: "intermediate",
    primitives: [
      "Workflow V3",
      "MCP tool",
      "APPROVAL",
      "Artifact",
      "REMOTE_HTTP",
    ],
    requirements: [
      "OSVA web, worker, workflow orchestrator, artifact storage",
      "MCP connector and runtime reachable from the worker",
    ],
    osvaVersion: "1.0.0",
    limitations: [
      "Fixture-backed page inspection—no live crawler, Search Console, or SERP APIs in the default path.",
      "Rule-based analysis—not a commercial site audit product.",
      "Approve/reject only; cannot edit findings inside OSVA 1.0 approval UI.",
    ],
    sourcePath: "examples/04-seo-worker",
    fixtureBacked: true,
    featured: true,
    consoleNextSteps: [
      {
        label: "Open Workflow Builder",
        to: "/workflows/new",
        requiresWrite: true,
      },
      { label: "Tools registry", to: "/tools" },
    ],
  }),
  entry({
    id: "05-research-analyst-worker",
    title: "Research analyst worker",
    description:
      "Plan → collect (MCP) → extract → analyze → review → approval → report with evidence traceability and conflict handling in a durable workflow.",
    category: "research",
    keywords: [
      "research",
      "analyst",
      "market",
      "evidence",
      "collect",
      "report",
      "investigate",
      "analysis",
    ],
    complexity: "intermediate",
    primitives: ["Workflow V3", "MCP", "APPROVAL", "Artifact", "REMOTE_HTTP"],
    requirements: [
      "OSVA web, worker, workflow orchestrator, MCP + runtime reachability",
    ],
    osvaVersion: "1.0.0",
    limitations: [
      "Employee-style showcase workflow—live integrations depend on your deployment and connectors.",
      "Offline CI validates contracts and smoke paths, not your live deployment.",
    ],
    sourcePath: "examples/05-research-analyst-worker",
    fixtureBacked: true,
    consoleNextSteps: [
      {
        label: "Open Workflow Builder",
        to: "/workflows/new",
        requiresWrite: true,
      },
    ],
  }),
  entry({
    id: "06-customer-support-worker",
    title: "Customer support worker",
    description:
      "Classify tickets, lookup policy via MCP, branch on outcomes, and route through approval, automated action, or escalation to a customer response.",
    category: "operations",
    keywords: [
      "customer",
      "support",
      "ticket",
      "helpdesk",
      "refund",
      "cancel",
      "classify",
      "escalation",
      "service",
    ],
    complexity: "intermediate",
    primitives: ["Workflow V3", "BRANCH", "MCP", "APPROVAL", "REMOTE_HTTP"],
    requirements: [
      "OSVA web, worker, workflow orchestrator, MCP + runtime reachability",
    ],
    osvaVersion: "1.0.0",
    limitations: [
      "Demo refunds/cancellations— not production billing integrations.",
      "Fixture-backed lookups unless you wire real connectors.",
    ],
    sourcePath: "examples/06-customer-support-worker",
    fixtureBacked: true,
    featured: true,
    consoleNextSteps: [
      {
        label: "Open Workflow Builder",
        to: "/workflows/new",
        requiresWrite: true,
      },
    ],
  }),
  entry({
    id: "07-growth-analyst-worker",
    title: "Growth analyst worker",
    description:
      "Collect metrics via MCP, analyze funnels and opportunities, draft experiments, prioritize, seek approval, and produce a growth brief artifact.",
    category: "research",
    keywords: [
      "growth",
      "funnel",
      "metrics",
      "experiments",
      "opportunities",
      "analytics",
      "brief",
    ],
    complexity: "intermediate",
    primitives: ["Workflow V3", "MCP", "APPROVAL", "Artifact"],
    requirements: [
      "OSVA web, worker, workflow orchestrator, MCP + runtime reachability",
    ],
    osvaVersion: "1.0.0",
    limitations: [
      "Does not connect to live ad platforms or analytics unless you add connectors.",
    ],
    sourcePath: "examples/07-growth-analyst-worker",
    fixtureBacked: true,
    consoleNextSteps: [
      {
        label: "Open Workflow Builder",
        to: "/workflows/new",
        requiresWrite: true,
      },
    ],
  }),
  entry({
    id: "08-product-manager-worker",
    title: "Product manager worker",
    description:
      "Collect product evidence via MCP, cluster themes, prioritize, draft, review, approval-gate, and publish a product brief artifact.",
    category: "operations",
    keywords: [
      "product",
      "manager",
      "roadmap",
      "prioritize",
      "feedback",
      "brief",
      "evidence",
    ],
    complexity: "intermediate",
    primitives: ["Workflow V3", "MCP", "APPROVAL", "Artifact"],
    requirements: [
      "OSVA web, worker, workflow orchestrator, MCP + runtime reachability",
    ],
    osvaVersion: "1.0.0",
    limitations: [
      "Evidence collection uses demo/fixture paths unless extended.",
    ],
    sourcePath: "examples/08-product-manager-worker",
    fixtureBacked: true,
    consoleNextSteps: [
      {
        label: "Open Workflow Builder",
        to: "/workflows/new",
        requiresWrite: true,
      },
    ],
  }),
  entry({
    id: "09-founders-office-worker",
    title: "Founder's office worker",
    description:
      "Collect executive signals, normalize and detect themes, prioritize actions, seek approval, and deliver an executive brief artifact.",
    category: "operations",
    keywords: [
      "founder",
      "executive",
      "brief",
      "signals",
      "strategy",
      "office",
      "leadership",
    ],
    complexity: "intermediate",
    primitives: ["Workflow V3", "MCP", "APPROVAL", "Artifact"],
    requirements: [
      "OSVA web, worker, workflow orchestrator, MCP + runtime reachability",
    ],
    osvaVersion: "1.0.0",
    limitations: [
      "Signal sources are illustrative unless you integrate real feeds.",
    ],
    sourcePath: "examples/09-founders-office-worker",
    fixtureBacked: true,
    consoleNextSteps: [
      {
        label: "Open Workflow Builder",
        to: "/workflows/new",
        requiresWrite: true,
      },
    ],
  }),
  entry({
    id: "10-incident-response-worker",
    title: "Incident response worker",
    description:
      "Triage incidents, run diagnostics via MCP, assess severity, plan remediation, approval-gate simulated fixes, verify, branch, and publish an incident report.",
    category: "operations",
    keywords: [
      "incident",
      "response",
      "oncall",
      "severity",
      "triage",
      "diagnostics",
      "remediation",
      "outage",
    ],
    complexity: "advanced",
    primitives: ["Workflow V3", "MCP", "APPROVAL", "BRANCH", "Artifact"],
    requirements: [
      "OSVA web, worker, workflow orchestrator, MCP + runtime reachability",
    ],
    osvaVersion: "1.0.0",
    limitations: [
      "Simulated remediation—does not mutate production infrastructure by default.",
    ],
    sourcePath: "examples/10-incident-response-worker",
    fixtureBacked: true,
    consoleNextSteps: [
      {
        label: "Open Workflow Builder",
        to: "/workflows/new",
        requiresWrite: true,
      },
    ],
  }),
  entry({
    id: "11-growth-operations-worker",
    title: "Growth operations worker",
    description:
      "Flagship multi-source growth operations workflow with critic routing, branching, approvals, demo actions, verification, and an operations brief.",
    category: "operations",
    keywords: [
      "growth",
      "operations",
      "ops",
      "multi",
      "source",
      "critic",
      "branch",
      "campaign",
    ],
    complexity: "advanced",
    primitives: ["Workflow V3", "BRANCH", "MCP", "APPROVAL", "Artifact"],
    requirements: [
      "OSVA web, worker, workflow orchestrator, MCP + runtime reachability",
    ],
    osvaVersion: "1.0.0",
    limitations: [
      "Demo actions and fixture-backed sources— not live ad spend or CRM writes.",
    ],
    sourcePath: "examples/11-growth-operations-worker",
    fixtureBacked: true,
    consoleNextSteps: [
      {
        label: "Open Workflow Builder",
        to: "/workflows/new",
        requiresWrite: true,
      },
    ],
  }),
  entry({
    id: "16-knowledge-rag-agent",
    title: "Knowledge / RAG agent",
    description:
      "Answer questions using `context.knowledge.search()` with manifest knowledge bindings and KNOWLEDGE run-step observability.",
    category: "knowledge",
    keywords: [
      "knowledge",
      "rag",
      "retrieval",
      "search",
      "docs",
      "index",
      "qa",
      "answer",
    ],
    complexity: "intermediate",
    primitives: ["KnowledgeIndex", "Knowledge binding", "KNOWLEDGE run steps"],
    requirements: [
      "Populated KnowledgeIndex ID for live runs",
      "OSVA 1.0.0 with knowledge capability enabled",
    ],
    osvaVersion: "1.0.0",
    limitations: [
      "Tests mock knowledge transport—live retrieval requires a populated index.",
      "Deterministic answer shaping without a separate model call in the default example.",
    ],
    sourcePath: "examples/16-knowledge-rag-agent",
    fixtureBacked: true,
    featured: true,
    consoleNextSteps: [
      { label: "Knowledge", to: "/knowledge" },
      { label: "Open Agent Studio", to: "/agents/new", requiresWrite: true },
    ],
  }),
  entry({
    id: "19-research-report-agent",
    title: "Research & Report agent",
    description:
      "npm MCP metadata + optional downloads, model synthesis via ModelGateway, Markdown artifact, and optional EvaluationSuite acceptance (OSVA 1.1.x).",
    category: "research",
    keywords: [
      "report",
      "business",
      "npm",
      "package",
      "research",
      "markdown",
      "evaluation",
      "generate",
    ],
    complexity: "advanced",
    primitives: [
      "ModelGateway",
      "MCP",
      "Artifact",
      "EvaluationSuite",
      "TRUSTED_TYPESCRIPT",
    ],
    requirements: [
      "OSVA Community 1.1.x for live runs",
      "ModelProfileVersion with provider credentials",
      "MCP/npm connector reachability from worker",
    ],
    osvaVersion: "1.1.x",
    limitations: [
      "Targets 1.1.x APIs—repo-wide osva-examples baseline remains 1.0.0.",
      "Live model output is non-deterministic unless using the documented fixture package.",
      "Loopback HTTP MCP bridge is example-local glue for REMOTE_HTTP demos.",
    ],
    sourcePath: "examples/19-research-report-agent",
    fixtureBacked: true,
    featured: true,
    verification: {
      offlineCiSmoke: true,
      liveIntegrationVerified: false,
    },
    consoleNextSteps: [
      { label: "Models", to: "/models" },
      { label: "Testing Studio", to: "/testing" },
      { label: "Open Agent Studio", to: "/agents/new", requiresWrite: true },
    ],
  }),
];

export const OSVA_EXAMPLE_CATALOG_PROVENANCE = {
  repository: OSVA_EXAMPLES_REPO,
  auditedCommitSha: OSVA_EXAMPLES_AUDITED_SHA,
} as const;

const catalogById = new Map(
  OSVA_EXAMPLE_CATALOG.map((entry) => [entry.id, entry]),
);

export function getExampleById(
  id: string,
): OsvaExampleCatalogEntry | undefined {
  return catalogById.get(id);
}

export const EXAMPLE_CATEGORIES: readonly {
  id: ExampleCategory;
  label: string;
}[] = [
  { id: "getting-started", label: "Getting started" },
  { id: "workflow-automation", label: "Workflow automation" },
  { id: "operations", label: "Operations" },
  { id: "knowledge", label: "Knowledge" },
  { id: "research", label: "Research & analysis" },
];

export const EXAMPLE_COMPLEXITY_LEVELS: readonly {
  id: ExampleComplexity;
  label: string;
}[] = [
  { id: "intro", label: "Intro" },
  { id: "intermediate", label: "Intermediate" },
  { id: "advanced", label: "Advanced" },
];

export function getFeaturedExamples(): readonly OsvaExampleCatalogEntry[] {
  return OSVA_EXAMPLE_CATALOG.filter((entry) => entry.featured === true);
}

/** Used by unit tests to guard catalog integrity. */
export function validateOsvaExampleCatalog(): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const entry of OSVA_EXAMPLE_CATALOG) {
    if (ids.has(entry.id)) {
      errors.push(`Duplicate example id: ${entry.id}`);
    }
    ids.add(entry.id);
    if (!entry.sourcePath.startsWith("examples/")) {
      errors.push(`${entry.id}: sourcePath must live under examples/`);
    }
    if (!isAllowedOsvaExamplesUrl(entry.sourceReadmeUrl)) {
      errors.push(`${entry.id}: README URL failed allowlist check`);
    }
    if (entry.keywords.length === 0) {
      errors.push(`${entry.id}: keywords must not be empty`);
    }
    if (entry.verification.sourceDocumented !== true) {
      errors.push(`${entry.id}: must be source documented`);
    }
  }
  return errors;
}
