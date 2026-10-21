import type { AgentResource, AgentVersionResource } from "../hooks/use-agents";
import type {
  ModelProfileResource,
  ModelProfileVersionResource,
  ModelProviderConnectionResource,
} from "../hooks/use-models";
import type { RunResource } from "../hooks/use-runs";
import type { WorkflowResource } from "../hooks/use-workflows";
import { readAgentRuntimeView } from "./agent-manifest-view";

export interface OnboardingContext {
  readonly agentId?: string;
  readonly agentVersionId?: string;
  readonly runId?: string;
}

export interface OnboardingStep {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly to: string;
  readonly actionLabel: string;
  readonly requiresWrite?: boolean;
  readonly requiresExecute?: boolean;
}

export type OnboardingStepStatus =
  "complete" | "current" | "upcoming" | "blocked";

export interface NoCodeOnboardingStep extends OnboardingStep {
  readonly status: OnboardingStepStatus;
  readonly statusDetail: string;
}

export function parseOnboardingContext(
  searchParams: URLSearchParams,
): OnboardingContext {
  return {
    agentId: optionalId(searchParams.get("agentId")),
    agentVersionId: optionalId(searchParams.get("agentVersionId")),
    runId: optionalId(searchParams.get("runId")),
  };
}

export function onboardingSearch(context: OnboardingContext): string {
  const params = new URLSearchParams();
  if (context.agentId !== undefined) {
    params.set("agentId", context.agentId);
  }
  if (context.agentVersionId !== undefined) {
    params.set("agentVersionId", context.agentVersionId);
  }
  if (context.runId !== undefined) {
    params.set("runId", context.runId);
  }
  const query = params.toString();
  return query.length === 0 ? "" : `?${query}`;
}

export interface OnboardingProgressInput {
  readonly workspaceSelected: boolean;
  readonly modelProfiles: readonly ModelProfileResource[] | undefined;
  readonly modelProfileVersions:
    | ReadonlyArray<{
        readonly profileId: string;
        readonly versions: readonly ModelProfileVersionResource[];
      }>
    | undefined;
  readonly modelConnections:
    readonly ModelProviderConnectionResource[] | undefined;
  readonly agents: readonly AgentResource[] | undefined;
  readonly agentVersions:
    | ReadonlyArray<{
        readonly agentId: string;
        readonly versions: readonly AgentVersionResource[];
      }>
    | undefined;
  readonly runs: readonly RunResource[] | undefined;
  readonly workflows: readonly WorkflowResource[] | undefined;
  readonly context: OnboardingContext;
}

export interface OnboardingProgressFlags {
  readonly workspaceReady: boolean;
  readonly modelReady: boolean;
  readonly declarativeAgentReady: boolean;
  readonly publishedVersionReady: boolean;
  readonly sampleRunReady: boolean;
  readonly inspectRunReady: boolean;
  readonly workflowOptionalReady: boolean;
}

export function deriveOnboardingProgress(
  input: OnboardingProgressInput,
): OnboardingProgressFlags {
  const workspaceReady = input.workspaceSelected;
  const connectionCount = input.modelConnections?.length ?? 0;
  const profileVersions = input.modelProfileVersions ?? [];
  const boundProfileVersion = profileVersions.some((entry) =>
    entry.versions.some(
      (version) =>
        version.modelProviderConnectionVersionId !== undefined &&
        version.modelProviderConnectionVersionId.length > 0,
    ),
  );
  const modelReady = connectionCount > 0 && boundProfileVersion;

  const agents = input.agents ?? [];
  const versionEntries = input.agentVersions ?? [];
  const declarativeVersion = findDeclarativePublishedVersion(versionEntries);
  const declarativeAgentReady = agents.length > 0;
  const publishedVersionReady = declarativeVersion !== undefined;

  const runs = input.runs ?? [];
  const contextRun =
    input.context.runId !== undefined
      ? runs.find((run) => run.id === input.context.runId)
      : undefined;
  const anyRun = runs.length > 0;
  const sampleRunReady =
    contextRun !== undefined ||
    (anyRun && publishedVersionReady && declarativeVersion !== undefined);

  const inspectRunReady =
    contextRun !== undefined &&
    (contextRun.status === "SUCCEEDED" ||
      contextRun.status === "FAILED" ||
      contextRun.status === "TIMED_OUT" ||
      contextRun.status === "CANCELLED");

  const workflowOptionalReady = (input.workflows?.length ?? 0) > 0;

  return {
    workspaceReady,
    modelReady,
    declarativeAgentReady,
    publishedVersionReady,
    sampleRunReady,
    inspectRunReady,
    workflowOptionalReady,
  };
}

export function noCodeFirstAgentSteps(
  context: OnboardingContext,
  flags: OnboardingProgressFlags,
): readonly NoCodeOnboardingStep[] {
  const agentId = context.agentId;
  const agentVersionId = context.agentVersionId;
  const runId = context.runId;
  const versionPath =
    agentId !== undefined && agentVersionId !== undefined
      ? `/agents/${encodeURIComponent(agentId)}/versions/${encodeURIComponent(agentVersionId)}`
      : agentId !== undefined
        ? `/agents/${encodeURIComponent(agentId)}`
        : "/agents/new";
  const builderSearch =
    agentId !== undefined && agentVersionId !== undefined
      ? `?agentId=${encodeURIComponent(agentId)}&agentVersionId=${encodeURIComponent(agentVersionId)}`
      : "";
  const onboardingLink = `/onboarding${onboardingSearch(context)}`;

  const steps: Array<Omit<NoCodeOnboardingStep, "status" | "statusDetail">> = [
    {
      id: "workspace",
      title: "Select workspace",
      description:
        "All resources and Runs are scoped to the workspace selected in the sidebar.",
      to: "/select-workspace",
      actionLabel: "Switch workspace",
    },
    {
      id: "model",
      title: "Configure an approved model",
      description:
        "Create a provider connection, then a model profile version that references it. Declarative agents bind a profile version at publish time.",
      to: "/models",
      actionLabel: "Open Models",
      requiresWrite: true,
    },
    {
      id: "create-agent",
      title: "Create a declarative agent",
      description:
        "Use Agent Studio to define instructions and capabilities without editing runtime manifest JSON in the browser.",
      to: "/agents/new",
      actionLabel: "Create Agent",
      requiresWrite: true,
    },
    {
      id: "publish",
      title: "Publish an immutable AgentVersion",
      description:
        "Publishing appends a new version. Previous versions are never rewritten.",
      to: versionPath,
      actionLabel: "Publish version",
      requiresWrite: true,
    },
    {
      id: "run",
      title: "Run a sample task",
      description:
        "Launch a Run from the AgentVersion page. HTTP 201 means queued, not SUCCEEDED.",
      to: versionPath,
      actionLabel: "Run Agent",
      requiresExecute: true,
    },
    {
      id: "inspect",
      title: "Inspect output and execution details",
      description:
        "Review RunAttempts, terminal output, and artifacts on Run Detail.",
      to: runId === undefined ? "/runs" : `/runs/${encodeURIComponent(runId)}`,
      actionLabel: "Open Run",
    },
    {
      id: "workflow",
      title: "Optional: add tools and build a workflow",
      description:
        "Workflows pin immutable AgentVersion ids on AGENT nodes. Saving a workflow does not mutate the AgentVersion.",
      to: `/workflows/new${builderSearch}`,
      actionLabel: "Open Workflow Builder",
      requiresWrite: true,
    },
  ];

  const completion: Record<string, boolean> = {
    workspace: flags.workspaceReady,
    model: flags.modelReady,
    "create-agent": flags.declarativeAgentReady,
    publish: flags.publishedVersionReady,
    run: flags.sampleRunReady,
    inspect: flags.inspectRunReady,
    workflow: flags.workflowOptionalReady,
  };

  let foundCurrent = false;
  return steps.map((step) => {
    const isComplete = completion[step.id] === true;
    let status: OnboardingStepStatus;
    let statusDetail: string;
    if (isComplete) {
      status = "complete";
      statusDetail = "Complete based on workspace data loaded from the API.";
    } else if (!foundCurrent) {
      foundCurrent = true;
      status = "current";
      statusDetail = "Next recommended step.";
    } else {
      status = "upcoming";
      statusDetail = "Complete earlier steps first.";
    }
    if (step.id === "workflow" && !flags.workflowOptionalReady) {
      statusDetail = "Optional — skip until you need multi-step automation.";
    }
    if (step.id === "workspace" && !flags.workspaceReady) {
      statusDetail = "Choose a workspace to continue.";
    }
    if (step.to === onboardingLink) {
      statusDetail = step.description;
    }
    return { ...step, status, statusDetail };
  });
}

/** Developer / Hello Agent path — preserved for code-based execution. */
export function developerOnboardingSteps(
  context: OnboardingContext,
): readonly OnboardingStep[] {
  const agentId = context.agentId;
  const agentVersionId = context.agentVersionId;
  const runId = context.runId;
  const versionPath =
    agentId !== undefined && agentVersionId !== undefined
      ? `/agents/${encodeURIComponent(agentId)}/versions/${encodeURIComponent(agentVersionId)}`
      : agentId !== undefined
        ? `/agents/${encodeURIComponent(agentId)}`
        : "/agents/new/developer";

  return [
    {
      id: "dev-create",
      title: "Create Agent (developer path)",
      description:
        "Register an agent and append a manifest for trusted TypeScript, containers, or remote HTTP runtimes.",
      to: "/agents/new/developer",
      actionLabel: "Developer create",
      requiresWrite: true,
    },
    {
      id: "dev-runtime",
      title: "Configure worker runtime files",
      description:
        "Trusted TypeScript requires OSVA_TRUSTED_RUNTIME_ROOT and a matching sha256 integrity digest on the worker.",
      to: versionPath,
      actionLabel: "Runtime notes",
    },
    {
      id: "dev-launch",
      title: "Launch Run and inspect attempts",
      description:
        "Use the Hello Agent example under examples/hello-agent with normal Registry APIs.",
      to: runId === undefined ? "/runs" : `/runs/${encodeURIComponent(runId)}`,
      actionLabel: "Open Runs",
      requiresExecute: true,
    },
  ];
}

/** @deprecated Use noCodeFirstAgentSteps — kept for tests referencing step ids. */
export function firstAgentOnboardingSteps(
  context: OnboardingContext,
): readonly OnboardingStep[] {
  return noCodeFirstAgentSteps(context, {
    workspaceReady: true,
    modelReady: false,
    declarativeAgentReady: false,
    publishedVersionReady: false,
    sampleRunReady: false,
    inspectRunReady: false,
    workflowOptionalReady: false,
  }).map((step) => ({
    id: step.id,
    title: step.title,
    description: step.description,
    to: step.to,
    actionLabel: step.actionLabel,
    ...(step.requiresWrite === undefined
      ? {}
      : { requiresWrite: step.requiresWrite }),
    ...(step.requiresExecute === undefined
      ? {}
      : { requiresExecute: step.requiresExecute }),
  }));
}

function findDeclarativePublishedVersion(
  entries: ReadonlyArray<{
    readonly agentId: string;
    readonly versions: readonly AgentVersionResource[];
  }>,
): AgentVersionResource | undefined {
  for (const entry of entries) {
    for (const version of entry.versions) {
      const runtime = readAgentRuntimeView(version.manifest);
      if (runtime.type === "DECLARATIVE") {
        return version;
      }
    }
  }
  return undefined;
}

function optionalId(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
