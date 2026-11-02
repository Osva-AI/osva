import { useAuth } from "../context/auth-context";
import { ConsoleApiError } from "../lib/console-api";
import {
  mapQueryToRegistryState,
  selectHomePresentation,
  type HomePresentationSelection,
  type HomeRegistryEvidence,
} from "../lib/home-presentation-state";
import {
  collectAttentionFromRecentRuns,
  collectAttentionFromRecentWorkflowRuns,
} from "../lib/overview-attention";
import {
  presentRecentList,
  presentRegistryCount,
} from "../lib/overview-counts";
import {
  roleCanExecuteControlPlaneActions,
  roleCanWriteControlPlaneResources,
} from "../lib/permissions";
import { useAgentsListQuery } from "./use-agents";
import { useAuthContextQuery } from "./use-auth-context";
import {
  useModelBindingReadinessQuery,
  useModelProfilesListQuery,
  useModelProviderConnectionsListQuery,
} from "./use-models";
import { useHomePresentationPreference } from "./use-home-presentation-preference";
import { useRunsListQuery } from "./use-runs";
import { useWorkflowRunsListQuery } from "./use-workflow-runs";
import { useWorkflowsListQuery } from "./use-workflows";
import { useWorkspaceQueryScope } from "./use-workspace-query-scope";

export const HOME_RECENT_LIMIT = 8;

export function describeHomeQueryError(error: unknown, label: string): string {
  if (error instanceof ConsoleApiError) {
    if (error.status === 403) {
      return `${label}: permission denied for your role.`;
    }
    return `${label}: ${error.message}`;
  }
  if (error instanceof Error) {
    return `${label}: ${error.message}`;
  }
  return `${label}: request failed.`;
}

export function useHomePageData() {
  const auth = useAuth();
  const workspaceScope = useWorkspaceQueryScope();
  const workspace =
    auth.workspaces.find((item) => item.workspaceId === workspaceScope) ??
    auth.selectedWorkspace;
  const workspaceAligned = workspaceScope !== undefined;

  const { preference, setPreference } = useHomePresentationPreference();

  const authContextQuery = useAuthContextQuery();
  const role = authContextQuery.data?.role ?? workspace?.role ?? "—";
  const authContext = authContextQuery.data;
  const authContextAligned = authContext?.workspaceId === workspaceScope;
  const authContextSettled =
    !workspaceAligned || authContextQuery.isFetched || authContextQuery.isError;
  const canWrite =
    authContextAligned &&
    authContext !== undefined &&
    roleCanWriteControlPlaneResources(authContext.role);
  const canExecute =
    authContextAligned &&
    authContext !== undefined &&
    roleCanExecuteControlPlaneActions(authContext.role);

  const agentsQuery = useAgentsListQuery();
  const workflowsQuery = useWorkflowsListQuery();
  const modelProfilesQuery = useModelProfilesListQuery();
  const modelConnectionsQuery = useModelProviderConnectionsListQuery();
  const modelBindingQuery = useModelBindingReadinessQuery();
  const recentRunsQuery = useRunsListQuery({ limit: HOME_RECENT_LIMIT });
  const recentWorkflowRunsQuery = useWorkflowRunsListQuery({
    limit: HOME_RECENT_LIMIT,
  });

  const agentCount = workspaceAligned
    ? agentsQuery.data?.agents.length
    : undefined;
  const workflowCount = workspaceAligned
    ? workflowsQuery.data?.workflows.length
    : undefined;

  const recentRuns = workspaceAligned ? (recentRunsQuery.data?.runs ?? []) : [];
  const recentWorkflowRuns = workspaceAligned
    ? (recentWorkflowRunsQuery.data?.workflowRuns ?? [])
    : [];

  const evidence: HomeRegistryEvidence = {
    agents: mapQueryToRegistryState({
      isLoading: agentsQuery.isLoading,
      isError: agentsQuery.isError,
      isFetched: agentsQuery.isFetched,
      workspaceAligned,
    }),
    agentCount,
    workflows: mapQueryToRegistryState({
      isLoading: workflowsQuery.isLoading,
      isError: workflowsQuery.isError,
      isFetched: workflowsQuery.isFetched,
      workspaceAligned,
    }),
    workflowCount,
    agentRuns: mapQueryToRegistryState({
      isLoading: recentRunsQuery.isLoading,
      isError: recentRunsQuery.isError,
      isFetched: recentRunsQuery.isFetched,
      workspaceAligned,
    }),
    agentRunCount: workspaceAligned ? recentRuns.length : undefined,
    workflowRuns: mapQueryToRegistryState({
      isLoading: recentWorkflowRunsQuery.isLoading,
      isError: recentWorkflowRunsQuery.isError,
      isFetched: recentWorkflowRunsQuery.isFetched,
      workspaceAligned,
    }),
    workflowRunCount: workspaceAligned ? recentWorkflowRuns.length : undefined,
  };

  const presentation: HomePresentationSelection = selectHomePresentation({
    workspaceAligned,
    preference,
    evidence,
    authContextSettled,
    authContextError: authContextQuery.isError,
  });

  const partialErrors: string[] = [];
  if (agentsQuery.isError) {
    partialErrors.push(describeHomeQueryError(agentsQuery.error, "Agents"));
  }
  if (workflowsQuery.isError) {
    partialErrors.push(
      describeHomeQueryError(workflowsQuery.error, "Workflows"),
    );
  }
  if (recentRunsQuery.isError) {
    partialErrors.push(
      describeHomeQueryError(recentRunsQuery.error, "Recent runs"),
    );
  }
  if (recentWorkflowRunsQuery.isError) {
    partialErrors.push(
      describeHomeQueryError(
        recentWorkflowRunsQuery.error,
        "Recent workflow runs",
      ),
    );
  }

  const attentionItems = [
    ...collectAttentionFromRecentRuns(recentRuns),
    ...collectAttentionFromRecentWorkflowRuns(recentWorkflowRuns),
  ].slice(0, 10);

  const agentCountView = presentRegistryCount(agentCount, "Agents");
  const workflowCountView = presentRegistryCount(workflowCount, "Workflows");
  const runsPresentation = presentRecentList(
    recentRuns.length,
    HOME_RECENT_LIMIT,
    recentRunsQuery.data?.nextCursor,
    "Runs",
  );
  const workflowRunsPresentation = presentRecentList(
    recentWorkflowRuns.length,
    HOME_RECENT_LIMIT,
    recentWorkflowRunsQuery.data?.nextCursor,
    "Workflow runs",
  );

  const workflows = workspaceAligned
    ? (workflowsQuery.data?.workflows ?? [])
    : [];
  const agents = workspaceAligned ? (agentsQuery.data?.agents ?? []) : [];

  return {
    workspace,
    workspaceAligned,
    workspaceScope,
    preference,
    setPreference,
    presentation,
    evidence,
    role,
    canWrite,
    canExecute,
    authContextQuery,
    partialErrors,
    attentionItems,
    agentCountView,
    workflowCountView,
    runsPresentation,
    workflowRunsPresentation,
    recentRuns,
    recentWorkflowRuns,
    recentRunsQuery,
    recentWorkflowRunsQuery,
    agentsQuery,
    workflowsQuery,
    agents,
    workflows,
    modelProfilesQuery,
    modelConnectionsQuery,
    modelBindingQuery,
  };
}

export type HomePageData = ReturnType<typeof useHomePageData>;
