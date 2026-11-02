import type { HomePresentationPreference } from "./home-presentation-preference";

export type HomeRegistryQueryState = "unsettled" | "success" | "error";

export interface HomeRegistryEvidence {
  readonly agents: HomeRegistryQueryState;
  readonly agentCount: number | undefined;
  readonly workflows: HomeRegistryQueryState;
  readonly workflowCount: number | undefined;
  readonly agentRuns: HomeRegistryQueryState;
  readonly agentRunCount: number | undefined;
  readonly workflowRuns: HomeRegistryQueryState;
  readonly workflowRunCount: number | undefined;
}

export type HomePresentationState =
  "loading" | "new" | "active" | "advanced" | "degraded";

export interface HomePresentationSelection {
  readonly state: HomePresentationState;
  readonly reason: string;
}

export interface SelectHomePresentationInput {
  readonly workspaceAligned: boolean;
  readonly preference: HomePresentationPreference;
  readonly evidence: HomeRegistryEvidence;
  readonly authContextSettled: boolean;
  readonly authContextError: boolean;
}

function registrySettled(state: HomeRegistryQueryState): boolean {
  return state === "success" || state === "error";
}

function registrySucceeded(state: HomeRegistryQueryState): boolean {
  return state === "success";
}

function hasWorkspaceActivity(evidence: HomeRegistryEvidence): boolean {
  if (evidence.agentCount !== undefined && evidence.agentCount > 0) {
    return true;
  }
  if (evidence.workflowCount !== undefined && evidence.workflowCount > 0) {
    return true;
  }
  if (evidence.agentRunCount !== undefined && evidence.agentRunCount > 0) {
    return true;
  }
  if (
    evidence.workflowRunCount !== undefined &&
    evidence.workflowRunCount > 0
  ) {
    return true;
  }
  return false;
}

function canClassifyEmptyWorkspace(evidence: HomeRegistryEvidence): boolean {
  return (
    registrySucceeded(evidence.agents) &&
    registrySucceeded(evidence.workflows) &&
    registrySucceeded(evidence.agentRuns) &&
    registrySucceeded(evidence.workflowRuns)
  );
}

function registryLoading(evidence: HomeRegistryEvidence): boolean {
  return (
    !registrySettled(evidence.agents) ||
    !registrySettled(evidence.workflows) ||
    !registrySettled(evidence.agentRuns) ||
    !registrySettled(evidence.workflowRuns)
  );
}

export function selectHomePresentation(
  input: SelectHomePresentationInput,
): HomePresentationSelection {
  if (!input.workspaceAligned) {
    return {
      state: "loading",
      reason: "Workspace context is not aligned with loaded queries.",
    };
  }

  if (!input.authContextSettled) {
    return {
      state: "loading",
      reason: "Workspace role and permissions are still loading.",
    };
  }

  if (registryLoading(input.evidence)) {
    return {
      state: "loading",
      reason: "Registry and recent-run queries have not settled.",
    };
  }

  if (hasWorkspaceActivity(input.evidence)) {
    if (input.preference === "advanced") {
      return {
        state: "advanced",
        reason: "Workspace has activity and Advanced presentation is selected.",
      };
    }
    return {
      state: "active",
      reason: "Workspace contains agents, workflows, or recent runs.",
    };
  }

  if (!canClassifyEmptyWorkspace(input.evidence)) {
    return {
      state: "degraded",
      reason:
        "One or more required queries failed or returned no data, so an empty workspace cannot be confirmed.",
    };
  }

  if (input.authContextError) {
    return {
      state: "degraded",
      reason: "Workspace role could not be loaded.",
    };
  }

  if (input.preference === "advanced") {
    return {
      state: "advanced",
      reason: "Advanced presentation is selected for an empty workspace.",
    };
  }

  return {
    state: "new",
    reason: "All required queries succeeded with no workspace activity.",
  };
}

export function mapQueryToRegistryState(input: {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly isFetched: boolean;
  readonly workspaceAligned: boolean;
}): HomeRegistryQueryState {
  if (!input.workspaceAligned) {
    return "unsettled";
  }
  if (input.isLoading && !input.isFetched) {
    return "unsettled";
  }
  if (input.isError) {
    return "error";
  }
  if (input.isFetched) {
    return "success";
  }
  return "unsettled";
}
