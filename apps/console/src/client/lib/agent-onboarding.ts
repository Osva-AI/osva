import type { AgentResource, AgentVersionResource } from "../hooks/use-agents";
import type {
  ModelProfileResource,
  ModelProfileVersionResource,
  ModelProviderConnectionResource,
} from "../hooks/use-models";
import type { RunResource } from "../hooks/use-runs";
import type { WorkflowResource } from "../hooks/use-workflows";
import { readAgentRuntimeView } from "./agent-manifest-view";
import { isRunLive, isRunTerminal } from "./statuses";

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

export type OnboardingRunPhase =
  | "none"
  | "not_in_loaded_page"
  | "pending"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";

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
  readonly runsListHasMore: boolean;
  readonly contextRun: RunResource | undefined;
  readonly workflows: readonly WorkflowResource[] | undefined;
  readonly context: OnboardingContext;
  readonly progressLoading: boolean;
  readonly progressLoadError: boolean;
}

export interface OnboardingProgressFlags {
  readonly workspaceReady: boolean;
  readonly modelReady: boolean;
  readonly declarativeAgentReady: boolean;
  readonly publishedVersionReady: boolean;
  /** A Run was created for the onboarding AgentVersion (any lifecycle state). */
  readonly sampleRunSubmitted: boolean;
  /** Run reached SUCCEEDED for the onboarding AgentVersion. */
  readonly sampleRunSucceeded: boolean;
  readonly inspectRunReady: boolean;
  readonly workflowOptionalReady: boolean;
  readonly runPhase: OnboardingRunPhase;
  readonly onboardingRun: RunResource | undefined;
  readonly runsListIncomplete: boolean;
  readonly progressIndeterminate: boolean;
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
  const declarativeVersion = resolveOnboardingDeclarativeVersion(
    versionEntries,
    input.context,
  );
  const targetAgentId =
    input.context.agentId ?? declarativeVersion?.agentId ?? undefined;
  const targetAgentVersionId =
    input.context.agentVersionId ?? declarativeVersion?.id ?? undefined;

  const declarativeAgentReady =
    targetAgentId !== undefined
      ? agents.some((agent) => agent.id === targetAgentId)
      : agents.length > 0;
  const publishedVersionReady = declarativeVersion !== undefined;

  const resolvedRun = resolveOnboardingRun({
    runs: input.runs,
    contextRun: input.contextRun,
    context: input.context,
    targetAgentId,
    targetAgentVersionId,
  });

  const runPhase = runPhaseFromResource(resolvedRun.run);
  const sampleRunSubmitted =
    resolvedRun.run !== undefined &&
    runMatchesOnboardingTarget(resolvedRun.run, {
      agentId: targetAgentId,
      agentVersionId: targetAgentVersionId,
    });
  const sampleRunSucceeded =
    sampleRunSubmitted && resolvedRun.run?.status === "SUCCEEDED";
  const inspectRunReady = sampleRunSucceeded;

  const runsListIncomplete =
    resolvedRun.source === "none" &&
    targetAgentVersionId !== undefined &&
    publishedVersionReady &&
    input.runsListHasMore;

  const progressIndeterminate =
    input.progressLoading ||
    input.progressLoadError ||
    (input.context.runId !== undefined &&
      input.contextRun === undefined &&
      !input.progressLoadError &&
      !input.progressLoading);

  const workflowOptionalReady = (input.workflows?.length ?? 0) > 0;

  const base: OnboardingProgressFlags = {
    workspaceReady,
    modelReady,
    declarativeAgentReady,
    publishedVersionReady,
    sampleRunSubmitted,
    sampleRunSucceeded,
    inspectRunReady,
    workflowOptionalReady,
    runPhase,
    onboardingRun: resolvedRun.run,
    runsListIncomplete,
    progressIndeterminate,
  };

  if (input.progressLoadError) {
    return {
      ...base,
      sampleRunSubmitted: false,
      sampleRunSucceeded: false,
      inspectRunReady: false,
      onboardingRun: undefined,
      runPhase: "none",
      progressIndeterminate: true,
    };
  }

  if (input.progressLoading) {
    return {
      ...base,
      sampleRunSucceeded: false,
      inspectRunReady: false,
      progressIndeterminate: true,
    };
  }

  return base;
}

export function noCodeFirstAgentSteps(
  context: OnboardingContext,
  flags: OnboardingProgressFlags,
): readonly NoCodeOnboardingStep[] {
  const agentId = context.agentId;
  const agentVersionId = context.agentVersionId;
  const runId = flags.onboardingRun?.id ?? context.runId;
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
    run: flags.sampleRunSubmitted,
    inspect: flags.inspectRunReady,
    workflow: flags.workflowOptionalReady,
  };

  let foundCurrent = false;
  return steps.map((step) => {
    const isComplete = completion[step.id] === true;
    let status: OnboardingStepStatus;
    let statusDetail: string;
    if (flags.progressIndeterminate && step.id !== "workspace") {
      status = "upcoming";
      statusDetail = "Loading workspace progress from the API…";
    } else if (isComplete) {
      status = "complete";
      statusDetail = describeCompleteStepDetail(step.id, flags);
    } else if (!foundCurrent) {
      foundCurrent = true;
      status = "current";
      statusDetail = describeCurrentStepDetail(step.id, flags);
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
    sampleRunSubmitted: false,
    sampleRunSucceeded: false,
    inspectRunReady: false,
    workflowOptionalReady: false,
    runPhase: "none",
    onboardingRun: undefined,
    runsListIncomplete: false,
    progressIndeterminate: false,
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

function describeCompleteStepDetail(
  stepId: string,
  flags: OnboardingProgressFlags,
): string {
  switch (stepId) {
    case "run":
      return flags.sampleRunSucceeded
        ? "Sample Run reached SUCCEEDED."
        : `Run ${flags.onboardingRun?.id ?? ""} was submitted; inspect execution outcome separately.`.trim();
    case "inspect":
      return "Terminal SUCCEEDED Run with output available on Run Detail.";
    default:
      return "Complete based on workspace data loaded from the API.";
  }
}

function describeCurrentStepDetail(
  stepId: string,
  flags: OnboardingProgressFlags,
): string {
  switch (stepId) {
    case "model":
      return "Add a provider connection and a model profile version bound to that connection.";
    case "create-agent":
      return "Create an agent in Agent Studio before publishing a version.";
    case "publish":
      return "Publish a declarative AgentVersion with a bound model profile version.";
    case "run":
      return describeRunStepCurrentDetail(flags);
    case "inspect":
      return describeInspectStepCurrentDetail(flags);
    default:
      return "Next recommended step.";
  }
}

function describeRunStepCurrentDetail(flags: OnboardingProgressFlags): string {
  if (flags.runsListIncomplete) {
    return "No matching Run in the latest loaded page. Open Run Agent or Runs to confirm execution history.";
  }
  switch (flags.runPhase) {
    case "none":
    case "not_in_loaded_page":
      return "Start a Run from the AgentVersion page with sample JSON input.";
    case "pending":
      return "Run is PENDING. HTTP creation succeeded; wait for the worker to dequeue it.";
    case "queued":
      return "Run is QUEUED. Execution has not started yet.";
    case "running":
      return "Run is RUNNING. Wait for a terminal status before treating output as final.";
    case "failed":
      return "Run FAILED. Fix model configuration or input, then start a new Run.";
    case "cancelled":
      return "Run was CANCELLED. Start a new Run when ready.";
    case "timed_out":
      return "Run TIMED_OUT. Increase timeout or simplify the task, then retry.";
    case "succeeded":
      return "Run SUCCEEDED. Open Run Detail to inspect output.";
    default:
      return "Next recommended step.";
  }
}

function describeInspectStepCurrentDetail(
  flags: OnboardingProgressFlags,
): string {
  if (!flags.sampleRunSubmitted) {
    return "Submit a sample Run first, then return here after it reaches SUCCEEDED.";
  }
  switch (flags.runPhase) {
    case "pending":
    case "queued":
    case "running":
      return "Run is still in progress. Refresh Run Detail after a terminal status.";
    case "failed":
      return "Run FAILED. Review error guidance on Run Detail, adjust configuration, and retry.";
    case "cancelled":
      return "Run was CANCELLED. Start a new Run to inspect successful output.";
    case "timed_out":
      return "Run TIMED_OUT. Review diagnostics on Run Detail and retry.";
    case "succeeded":
      return "Open Run Detail to read persisted output and attempts.";
    default:
      return "Next recommended step.";
  }
}

function resolveOnboardingDeclarativeVersion(
  entries: ReadonlyArray<{
    readonly agentId: string;
    readonly versions: readonly AgentVersionResource[];
  }>,
  context: OnboardingContext,
): AgentVersionResource | undefined {
  if (context.agentId !== undefined && context.agentVersionId !== undefined) {
    const entry = entries.find((item) => item.agentId === context.agentId);
    const version = entry?.versions.find(
      (item) => item.id === context.agentVersionId,
    );
    if (
      version !== undefined &&
      readAgentRuntimeView(version.manifest).type === "DECLARATIVE"
    ) {
      return version;
    }
  }
  return findDeclarativePublishedVersion(entries);
}

function resolveOnboardingRun(input: {
  readonly runs: readonly RunResource[] | undefined;
  readonly contextRun: RunResource | undefined;
  readonly context: OnboardingContext;
  readonly targetAgentId: string | undefined;
  readonly targetAgentVersionId: string | undefined;
}): {
  readonly run: RunResource | undefined;
  readonly source: "context" | "list" | "none";
} {
  if (input.context.runId !== undefined && input.contextRun !== undefined) {
    if (input.contextRun.id !== input.context.runId) {
      return { run: undefined, source: "none" };
    }
    if (input.targetAgentVersionId === undefined) {
      return { run: undefined, source: "none" };
    }
    if (
      runMatchesOnboardingTarget(input.contextRun, {
        agentId: input.targetAgentId,
        agentVersionId: input.targetAgentVersionId,
      })
    ) {
      return { run: input.contextRun, source: "context" };
    }
    return { run: undefined, source: "none" };
  }

  const runs = input.runs ?? [];
  if (input.targetAgentVersionId !== undefined) {
    const match = runs.find((run) =>
      runMatchesOnboardingTarget(run, {
        agentId: input.targetAgentId,
        agentVersionId: input.targetAgentVersionId,
      }),
    );
    if (match !== undefined) {
      return { run: match, source: "list" };
    }
  }

  if (
    input.context.runId !== undefined &&
    input.contextRun === undefined &&
    runs.length === 0
  ) {
    return { run: undefined, source: "none" };
  }

  return { run: undefined, source: "none" };
}

function runMatchesOnboardingTarget(
  run: RunResource,
  target: {
    readonly agentId: string | undefined;
    readonly agentVersionId: string | undefined;
  },
): boolean {
  if (
    target.agentVersionId !== undefined &&
    run.effectiveBindings.agentVersionId !== target.agentVersionId
  ) {
    return false;
  }
  if (target.agentId !== undefined && run.agentId !== target.agentId) {
    return false;
  }
  return true;
}

function runPhaseFromResource(
  run: RunResource | undefined,
): OnboardingRunPhase {
  if (run === undefined) {
    return "none";
  }
  switch (run.status) {
    case "PENDING":
      return "pending";
    case "QUEUED":
      return "queued";
    case "RUNNING":
      return "running";
    case "SUCCEEDED":
      return "succeeded";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    case "TIMED_OUT":
      return "timed_out";
    default:
      return isRunLive(run.status)
        ? "running"
        : isRunTerminal(run.status)
          ? "failed"
          : "none";
  }
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
