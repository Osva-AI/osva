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
  readonly exampleId?: string;
}

/** Four visual onboarding stages (granular evidence steps map into these). */
export const GUIDED_ONBOARDING_VISUAL_STAGE_IDS = [
  "get-ready",
  "choose-model",
  "create-agent",
  "review-test",
] as const;

export type GuidedVisualStageId =
  (typeof GUIDED_ONBOARDING_VISUAL_STAGE_IDS)[number];

export interface GuidedVisualStageDefinition {
  readonly id: GuidedVisualStageId;
  readonly index: number;
  readonly title: string;
  readonly headline: string;
  readonly description: string;
}

export const GUIDED_ONBOARDING_VISUAL_STAGES: readonly GuidedVisualStageDefinition[] =
  [
    {
      id: "get-ready",
      index: 1,
      title: "Get ready",
      headline: "Let's make sure OSVA is ready",
      description:
        "We'll show what the Console can verify from your workspace. Execution infrastructure is only confirmed after a successful test Run.",
    },
    {
      id: "choose-model",
      index: 2,
      title: "Set up your AI model",
      headline: "Set up your AI model",
      description:
        "Confirm a model is configured in this workspace. You pick the exact model when you create your agent in Agent Studio.",
    },
    {
      id: "create-agent",
      index: 3,
      title: "Create your agent",
      headline: "Tell your agent what to do",
      description:
        "Name your agent and describe its job in plain language. Advanced capabilities stay optional in Agent Studio.",
    },
    {
      id: "review-test",
      index: 4,
      title: "Review, publish and test",
      headline: "Review, publish, and test",
      description:
        "Publish locks in your agent setup, then run a small test task. Finishing the test successfully is separate from publishing.",
    },
  ];

/** Core guided journey steps (workflow exploration is optional and separate). */
export const GUIDED_ONBOARDING_CORE_STEP_IDS = [
  "workspace",
  "model",
  "create-agent",
  "publish",
  "run",
  "inspect",
] as const;

export type GuidedOnboardingCoreStepId =
  (typeof GUIDED_ONBOARDING_CORE_STEP_IDS)[number];

export type OnboardingJourneyState =
  | "loading"
  | "not_started"
  | "in_progress"
  | "blocked"
  | "ready_to_test"
  | "running"
  | "succeeded"
  | "failed"
  | "indeterminate";

export type GuidedStepVisualState =
  "complete" | "current" | "upcoming" | "needs_attention" | "not_verified";

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
    exampleId: optionalId(searchParams.get("exampleId")),
  };
}

export function onboardingSearch(
  context: OnboardingContext,
  options?: { readonly viewStage?: GuidedVisualStageId },
): string {
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
  if (context.exampleId !== undefined) {
    params.set("exampleId", context.exampleId);
  }
  if (options?.viewStage !== undefined) {
    params.set("stage", options.viewStage);
  }
  const query = params.toString();
  return query.length === 0 ? "" : `?${query}`;
}

export function parseOnboardingViewStage(
  searchParams: URLSearchParams,
): GuidedVisualStageId | undefined {
  const raw = searchParams.get("stage")?.trim().toLowerCase();
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  if (raw === "1" || raw === "get-ready") {
    return "get-ready";
  }
  if (raw === "2" || raw === "choose-model") {
    return "choose-model";
  }
  if (raw === "3" || raw === "create-agent") {
    return "create-agent";
  }
  if (raw === "4" || raw === "review-test") {
    return "review-test";
  }
  return undefined;
}

export function granularStepToVisualStage(stepId: string): GuidedVisualStageId {
  switch (stepId) {
    case "workspace":
      return "get-ready";
    case "model":
      return "choose-model";
    case "create-agent":
      return "create-agent";
    case "publish":
    case "run":
    case "inspect":
      return "review-test";
    default:
      return "get-ready";
  }
}

export function visualStageDefinition(
  stageId: GuidedVisualStageId,
): GuidedVisualStageDefinition {
  const found = GUIDED_ONBOARDING_VISUAL_STAGES.find(
    (stage) => stage.id === stageId,
  );
  if (found === undefined) {
    return GUIDED_ONBOARDING_VISUAL_STAGES[0]!;
  }
  return found;
}

export function deriveRecommendedVisualStage(input: {
  readonly primaryGranularStepId: string | undefined;
  readonly flags: OnboardingProgressFlags;
  readonly controlPlaneReachable: boolean;
}): GuidedVisualStageId {
  if (!input.flags.workspaceReady || !input.controlPlaneReachable) {
    return "get-ready";
  }
  if (input.primaryGranularStepId !== undefined) {
    return granularStepToVisualStage(input.primaryGranularStepId);
  }
  if (!input.flags.modelReady) {
    return "choose-model";
  }
  if (!input.flags.declarativeAgentReady) {
    return "create-agent";
  }
  return "review-test";
}

export function visualStageEvidenceComplete(
  stageId: GuidedVisualStageId,
  flags: OnboardingProgressFlags,
  controlPlaneReachable: boolean,
): boolean {
  switch (stageId) {
    case "get-ready":
      return flags.workspaceReady && controlPlaneReachable;
    case "choose-model":
      return flags.modelReady;
    case "create-agent":
      return flags.declarativeAgentReady;
    case "review-test":
      return flags.sampleRunSucceeded;
    default:
      return false;
  }
}

export function visualStagePrerequisitesMet(
  stageId: GuidedVisualStageId,
  flags: OnboardingProgressFlags,
  controlPlaneReachable: boolean,
): boolean {
  switch (stageId) {
    case "get-ready":
      return true;
    case "choose-model":
      return (
        flags.workspaceReady &&
        controlPlaneReachable &&
        !flags.progressIndeterminate
      );
    case "create-agent":
      return (
        visualStagePrerequisitesMet(
          "choose-model",
          flags,
          controlPlaneReachable,
        ) && flags.modelReady
      );
    case "review-test":
      return (
        visualStagePrerequisitesMet(
          "create-agent",
          flags,
          controlPlaneReachable,
        ) && flags.declarativeAgentReady
      );
    default:
      return false;
  }
}

export interface VisualStageStepperItemState {
  readonly evidenceComplete: boolean;
  readonly isViewing: boolean;
  readonly isActionRequired: boolean;
  readonly needsAttention: boolean;
  readonly notVerified: boolean;
}

export function deriveVisualStageStepperItemState(
  stageId: GuidedVisualStageId,
  input: {
    readonly viewedStageId: GuidedVisualStageId;
    readonly recommendedStageId: GuidedVisualStageId;
    readonly flags: OnboardingProgressFlags;
    readonly controlPlaneReachable: boolean;
  },
): VisualStageStepperItemState {
  const evidenceComplete = visualStageEvidenceComplete(
    stageId,
    input.flags,
    input.controlPlaneReachable,
  );
  const notVerified =
    input.flags.progressIndeterminate && stageId !== "get-ready";
  const isViewing = stageId === input.viewedStageId;
  const isActionRequired =
    !evidenceComplete && stageId === input.recommendedStageId;
  const runNeedsRecovery =
    stageId === "review-test" &&
    input.flags.sampleRunSubmitted &&
    !input.flags.sampleRunSucceeded &&
    (input.flags.runPhase === "failed" ||
      input.flags.runPhase === "cancelled" ||
      input.flags.runPhase === "timed_out");
  const prerequisitesBlocked =
    isViewing &&
    !evidenceComplete &&
    !visualStagePrerequisitesMet(
      stageId,
      input.flags,
      input.controlPlaneReachable,
    );
  const needsAttention =
    !notVerified &&
    !evidenceComplete &&
    (runNeedsRecovery || prerequisitesBlocked);

  return {
    evidenceComplete,
    isViewing,
    isActionRequired,
    needsAttention,
    notVerified,
  };
}

export function visualStageStepperStatusLabel(
  state: VisualStageStepperItemState,
): string {
  if (state.notVerified) {
    return "Not verified";
  }
  if (state.evidenceComplete) {
    return "Complete";
  }
  if (state.needsAttention) {
    return "Needs attention";
  }
  if (state.isActionRequired) {
    return "Your task";
  }
  if (state.isViewing) {
    return "Viewing";
  }
  return "Upcoming";
}

/** @deprecated Stepper uses deriveVisualStageStepperItemState — kept for granular steps. */
export function visualStageNavVisualState(
  stageId: GuidedVisualStageId,
  input: {
    readonly viewedStageId: GuidedVisualStageId;
    readonly recommendedStageId: GuidedVisualStageId;
    readonly flags: OnboardingProgressFlags;
    readonly controlPlaneReachable: boolean;
  },
): GuidedStepVisualState {
  const item = deriveVisualStageStepperItemState(stageId, input);
  if (item.notVerified) {
    return "not_verified";
  }
  if (item.evidenceComplete) {
    return "complete";
  }
  if (item.needsAttention) {
    return "needs_attention";
  }
  if (item.isActionRequired) {
    return "current";
  }
  if (item.isViewing) {
    return "upcoming";
  }
  return "upcoming";
}

export interface UsableModelProfileVersionSummary {
  readonly profileId: string;
  readonly profileKey: string;
  readonly profileName: string;
  readonly version: ModelProfileVersionResource;
}

export function listUsableModelProfileVersions(input: {
  readonly modelProfiles: readonly ModelProfileResource[] | undefined;
  readonly modelProfileVersions:
    | ReadonlyArray<{
        readonly profileId: string;
        readonly versions: readonly ModelProfileVersionResource[];
      }>
    | undefined;
}): readonly UsableModelProfileVersionSummary[] {
  const profiles = input.modelProfiles ?? [];
  const versionEntries = input.modelProfileVersions ?? [];
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const summaries: UsableModelProfileVersionSummary[] = [];
  for (const entry of versionEntries) {
    const profile = byId.get(entry.profileId);
    if (profile === undefined) {
      continue;
    }
    for (const version of entry.versions) {
      if (
        version.modelProviderConnectionVersionId !== undefined &&
        version.modelProviderConnectionVersionId.length > 0
      ) {
        summaries.push({
          profileId: profile.id,
          profileKey: profile.key,
          profileName: profile.name,
          version,
        });
      }
    }
  }
  return summaries;
}

export function resolveOnboardingAgentVersionPath(
  context: OnboardingContext,
  flags: OnboardingProgressFlags,
): string {
  const agentId = context.agentId ?? flags.onboardingRun?.agentId;
  const agentVersionId =
    context.agentVersionId ??
    flags.onboardingRun?.effectiveBindings.agentVersionId;
  if (agentId !== undefined && agentVersionId !== undefined) {
    return `/agents/${encodeURIComponent(agentId)}/versions/${encodeURIComponent(agentVersionId)}`;
  }
  if (agentId !== undefined) {
    return `/agents/${encodeURIComponent(agentId)}`;
  }
  return "/agents/new";
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

export function deriveOnboardingJourneyState(
  flags: OnboardingProgressFlags,
  progressLoading: boolean,
  progressLoadError: boolean,
): OnboardingJourneyState {
  if (progressLoadError) {
    return "indeterminate";
  }
  if (progressLoading || flags.progressIndeterminate) {
    return "loading";
  }
  if (flags.sampleRunSucceeded) {
    return "succeeded";
  }
  if (!flags.workspaceReady) {
    return "not_started";
  }
  if (flags.publishedVersionReady && !flags.sampleRunSubmitted) {
    return "ready_to_test";
  }
  switch (flags.runPhase) {
    case "pending":
    case "queued":
    case "running":
      return "running";
    case "failed":
    case "cancelled":
    case "timed_out":
      return "failed";
    default:
      break;
  }
  if (!flags.modelReady || !flags.declarativeAgentReady) {
    return "in_progress";
  }
  if (flags.publishedVersionReady && flags.sampleRunSubmitted) {
    return "in_progress";
  }
  return "in_progress";
}

export function guidedOnboardingCoreSteps(
  steps: readonly NoCodeOnboardingStep[],
): readonly NoCodeOnboardingStep[] {
  const allowed = new Set<string>(GUIDED_ONBOARDING_CORE_STEP_IDS);
  return steps.filter((step) => allowed.has(step.id));
}

export function findPrimaryOnboardingStep(
  steps: readonly NoCodeOnboardingStep[],
): NoCodeOnboardingStep | undefined {
  const current = steps.find((step) => step.status === "current");
  if (current !== undefined) {
    return current;
  }
  const blocked = steps.find((step) => step.status === "blocked");
  if (blocked !== undefined) {
    return blocked;
  }
  if (
    steps.every((step) => step.id === "workflow" || step.status === "complete")
  ) {
    return steps.find((step) => step.id === "workflow");
  }
  return steps.find((step) => step.status === "upcoming");
}

export function guidedStepVisualState(
  step: NoCodeOnboardingStep,
  flags: OnboardingProgressFlags,
): GuidedStepVisualState {
  if (flags.progressIndeterminate && step.id !== "workspace") {
    return "not_verified";
  }
  if (step.status === "complete") {
    return "complete";
  }
  if (step.status === "current") {
    if (
      (step.id === "run" || step.id === "inspect") &&
      flags.sampleRunSubmitted &&
      !flags.sampleRunSucceeded
    ) {
      return "needs_attention";
    }
    return "current";
  }
  if (step.status === "blocked") {
    return "needs_attention";
  }
  return "upcoming";
}

export function guidedStepVisualLabel(state: GuidedStepVisualState): string {
  switch (state) {
    case "complete":
      return "Complete";
    case "current":
      return "Current";
    case "upcoming":
      return "Upcoming";
    case "needs_attention":
      return "Needs attention";
    case "not_verified":
      return "Not verified";
    default:
      return "Upcoming";
  }
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
      title: "Prepare workspace",
      description:
        "All resources and Runs are scoped to the workspace selected in the sidebar.",
      to: "/select-workspace",
      actionLabel: "Switch workspace",
    },
    {
      id: "model",
      title: "Configure model capabilities",
      description:
        "Choose the model your agent will use: create a provider connection, then a ModelProfileVersion bound to that connection. Declarative agents bind a profile version at publish time.",
      to: "/models",
      actionLabel: "Open Models",
      requiresWrite: true,
    },
    {
      id: "create-agent",
      title: "Create your agent",
      description:
        "Use Agent Studio to define instructions and capabilities without editing runtime manifest JSON in the browser.",
      to: "/agents/new",
      actionLabel: "Create Agent",
      requiresWrite: true,
    },
    {
      id: "publish",
      title: "Publish a version",
      description:
        "Publishing appends an immutable AgentVersion. Previous versions are never rewritten.",
      to: versionPath,
      actionLabel: "Publish version",
      requiresWrite: true,
    },
    {
      id: "run",
      title: "Test your agent",
      description:
        "Launch a Run from the AgentVersion page. HTTP 201 means queued, not SUCCEEDED.",
      to: versionPath,
      actionLabel: "Run Agent",
      requiresExecute: true,
    },
    {
      id: "inspect",
      title: "Inspect the result",
      description:
        "Review RunAttempts, terminal output, and artifacts on Run Detail after the Run reaches a terminal status.",
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
    return undefined;
  }
  if (context.agentId !== undefined) {
    const entry = entries.find((item) => item.agentId === context.agentId);
    if (entry !== undefined) {
      for (const version of entry.versions) {
        if (readAgentRuntimeView(version.manifest).type === "DECLARATIVE") {
          return version;
        }
      }
    }
    return undefined;
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
