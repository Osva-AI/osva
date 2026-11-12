import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  workspaceMutationFetch,
  workspaceScopedFetch,
} from "../lib/console-api";
import { ACTIVE_RUN_POLL_MS } from "../lib/query-client";
import { useWorkspaceQueryScope } from "./use-workspace-query-scope";

export interface OfficeWorkerResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly agentId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OfficeWorkerListResource {
  readonly items: readonly OfficeWorkerResource[];
}

export interface OfficeRoleResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OfficeRoleListResource {
  readonly items: readonly OfficeRoleResource[];
}

export interface OfficeTeamResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OfficeTeamListResource {
  readonly items: readonly OfficeTeamResource[];
}

export interface TeamMembershipResource {
  readonly teamId: string;
  readonly officeWorkerId: string;
  readonly roleId?: string;
}

export interface TeamMembershipListResource {
  readonly items: readonly TeamMembershipResource[];
}

export type AssignmentStatus =
  "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface OfficeAssignmentResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly goalId?: string;
  readonly officeWorkerId: string;
  readonly title: string;
  readonly description?: string;
  readonly targetType: "AGENT_VERSION" | "WORKFLOW_VERSION";
  readonly targetVersionId: string;
  readonly input: unknown;
  readonly status: AssignmentStatus;
  readonly runId?: string;
  readonly workflowRunId?: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly cancelledAt?: string;
}

export interface OfficeAssignmentListResource {
  readonly items: readonly OfficeAssignmentResource[];
}

export type GoalStatus = "OPEN" | "ACTIVE" | "COMPLETED" | "CANCELLED";

export interface OfficeGoalResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly title: string;
  readonly description?: string;
  readonly status: GoalStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OfficeGoalListResource {
  readonly items: readonly OfficeGoalResource[];
}

const OFFICE_STALE_MS = 60_000;
const OFFICE_ASSIGNMENTS_LIST_POLL_MS = 30_000;

export function patchOfficeAssignmentsListCache(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string | undefined,
  assignment: OfficeAssignmentResource,
): void {
  if (workspaceId === undefined) {
    return;
  }
  queryClient.setQueryData<OfficeAssignmentListResource>(
    ["office", workspaceId, "assignments"],
    (previous) => {
      if (previous === undefined) {
        return previous;
      }
      let found = false;
      const items = previous.items.map((item) => {
        if (item.id !== assignment.id) {
          return item;
        }
        found = true;
        return assignment;
      });
      if (!found) {
        return previous;
      }
      return { items };
    },
  );
  queryClient.setQueryData(
    ["office", workspaceId, "assignments", assignment.id],
    assignment,
  );
}

function invalidateOfficeMissionsAndTasks(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string | undefined,
): void {
  if (workspaceId === undefined) {
    return;
  }
  void queryClient.invalidateQueries({
    queryKey: ["office", workspaceId, "goals"],
  });
  void queryClient.invalidateQueries({
    queryKey: ["office", workspaceId, "assignments"],
  });
  void queryClient.invalidateQueries({
    queryKey: ["office", workspaceId, "inbox"],
  });
}

export function useOfficeWorkersQuery() {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["office", workspaceId, "workers"],
    enabled: workspaceId !== undefined,
    staleTime: OFFICE_STALE_MS,
    queryFn: () =>
      workspaceScopedFetch<OfficeWorkerListResource>(
        workspaceId,
        "/api/v1/office/workers",
      ),
  });
}

export function useOfficeWorkerQuery(officeWorkerId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["office", workspaceId, "workers", officeWorkerId],
    enabled:
      workspaceId !== undefined &&
      officeWorkerId !== undefined &&
      officeWorkerId.length > 0,
    staleTime: OFFICE_STALE_MS,
    queryFn: () =>
      workspaceScopedFetch<OfficeWorkerResource>(
        workspaceId,
        `/api/v1/office/workers/${encodeURIComponent(officeWorkerId!)}`,
      ),
  });
}

export function useCreateOfficeWorkerMutation() {
  const workspaceId = useWorkspaceQueryScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      readonly key: string;
      readonly name: string;
      readonly description?: string;
      readonly agentId: string;
    }) =>
      workspaceMutationFetch<OfficeWorkerResource>("/api/v1/office/workers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["office", workspaceId],
      });
    },
  });
}

export function useUpdateOfficeWorkerMutation(officeWorkerId: string) {
  const workspaceId = useWorkspaceQueryScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      readonly name?: string;
      readonly description?: string;
    }) =>
      workspaceMutationFetch<OfficeWorkerResource>(
        `/api/v1/office/workers/${encodeURIComponent(officeWorkerId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["office", workspaceId],
      });
    },
  });
}

export function useOfficeRolesQuery() {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["office", workspaceId, "roles"],
    enabled: workspaceId !== undefined,
    staleTime: OFFICE_STALE_MS,
    queryFn: () =>
      workspaceScopedFetch<OfficeRoleListResource>(
        workspaceId,
        "/api/v1/office/roles",
      ),
  });
}

export function useCreateOfficeRoleMutation() {
  const workspaceId = useWorkspaceQueryScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      readonly key: string;
      readonly name: string;
      readonly description?: string;
    }) =>
      workspaceMutationFetch<OfficeRoleResource>("/api/v1/office/roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["office", workspaceId, "roles"],
      });
    },
  });
}

export function useUpdateOfficeRoleMutation(roleId: string) {
  const workspaceId = useWorkspaceQueryScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      readonly name?: string;
      readonly description?: string;
    }) =>
      workspaceMutationFetch<OfficeRoleResource>(
        `/api/v1/office/roles/${encodeURIComponent(roleId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["office", workspaceId, "roles"],
      });
    },
  });
}

export function useOfficeTeamsQuery() {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["office", workspaceId, "teams"],
    enabled: workspaceId !== undefined,
    staleTime: OFFICE_STALE_MS,
    queryFn: () =>
      workspaceScopedFetch<OfficeTeamListResource>(
        workspaceId,
        "/api/v1/office/teams",
      ),
  });
}

export function useOfficeTeamQuery(teamId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["office", workspaceId, "teams", teamId],
    enabled:
      workspaceId !== undefined && teamId !== undefined && teamId.length > 0,
    staleTime: OFFICE_STALE_MS,
    queryFn: () =>
      workspaceScopedFetch<OfficeTeamResource>(
        workspaceId,
        `/api/v1/office/teams/${encodeURIComponent(teamId!)}`,
      ),
  });
}

export function useCreateOfficeTeamMutation() {
  const workspaceId = useWorkspaceQueryScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      readonly key: string;
      readonly name: string;
      readonly description?: string;
    }) =>
      workspaceMutationFetch<OfficeTeamResource>("/api/v1/office/teams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["office", workspaceId],
      });
    },
  });
}

export function useUpdateOfficeTeamMutation(teamId: string) {
  const workspaceId = useWorkspaceQueryScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      readonly name?: string;
      readonly description?: string;
    }) =>
      workspaceMutationFetch<OfficeTeamResource>(
        `/api/v1/office/teams/${encodeURIComponent(teamId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["office", workspaceId],
      });
    },
  });
}

export function useTeamMembershipsQuery(teamId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["office", workspaceId, "teams", teamId, "memberships"],
    enabled:
      workspaceId !== undefined && teamId !== undefined && teamId.length > 0,
    staleTime: OFFICE_STALE_MS,
    queryFn: () =>
      workspaceScopedFetch<TeamMembershipListResource>(
        workspaceId,
        `/api/v1/office/teams/${encodeURIComponent(teamId!)}/memberships`,
      ),
  });
}

export function useAddTeamMembershipMutation(teamId: string) {
  const workspaceId = useWorkspaceQueryScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      readonly officeWorkerId: string;
      readonly roleId?: string;
    }) =>
      workspaceMutationFetch<TeamMembershipResource>(
        `/api/v1/office/teams/${encodeURIComponent(teamId)}/memberships`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["office", workspaceId],
      });
    },
  });
}

export function useOfficeGoalsQuery() {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["office", workspaceId, "goals"],
    enabled: workspaceId !== undefined,
    staleTime: OFFICE_STALE_MS,
    queryFn: () =>
      workspaceScopedFetch<OfficeGoalListResource>(
        workspaceId,
        "/api/v1/office/goals",
      ),
  });
}

export function useOfficeGoalQuery(goalId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["office", workspaceId, "goals", goalId],
    enabled:
      workspaceId !== undefined && goalId !== undefined && goalId.length > 0,
    staleTime: OFFICE_STALE_MS,
    queryFn: () =>
      workspaceScopedFetch<OfficeGoalResource>(
        workspaceId,
        `/api/v1/office/goals/${encodeURIComponent(goalId!)}`,
      ),
  });
}

export function useCreateOfficeGoalMutation() {
  const workspaceId = useWorkspaceQueryScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      readonly key: string;
      readonly title: string;
      readonly description?: string;
    }) => {
      const pinnedWorkspaceId = workspaceId;
      return workspaceMutationFetch<OfficeGoalResource>(
        "/api/v1/office/goals",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        { workspaceId: pinnedWorkspaceId },
      );
    },
    onSuccess: () => {
      invalidateOfficeMissionsAndTasks(queryClient, workspaceId);
    },
  });
}

export function useUpdateOfficeGoalMutation(goalId: string) {
  const workspaceId = useWorkspaceQueryScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      readonly title?: string;
      readonly description?: string;
      readonly status?: GoalStatus;
    }) => {
      const pinnedWorkspaceId = workspaceId;
      return workspaceMutationFetch<OfficeGoalResource>(
        `/api/v1/office/goals/${encodeURIComponent(goalId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        { workspaceId: pinnedWorkspaceId },
      );
    },
    onSuccess: () => {
      invalidateOfficeMissionsAndTasks(queryClient, workspaceId);
    },
  });
}

export function useOfficeAssignmentsQuery(options?: {
  readonly pollListWhenRunning?: boolean;
}) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["office", workspaceId, "assignments"],
    enabled: workspaceId !== undefined,
    staleTime: OFFICE_STALE_MS,
    refetchInterval: (query) => {
      if (options?.pollListWhenRunning !== true) {
        return false;
      }
      const items = query.state.data?.items ?? [];
      return items.some((item) => item.status === "RUNNING")
        ? OFFICE_ASSIGNMENTS_LIST_POLL_MS
        : false;
    },
    queryFn: () =>
      workspaceScopedFetch<OfficeAssignmentListResource>(
        workspaceId,
        "/api/v1/office/assignments",
      ),
  });
}

export function useOfficeAssignmentQuery(assignmentId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["office", workspaceId, "assignments", assignmentId],
    enabled:
      workspaceId !== undefined &&
      assignmentId !== undefined &&
      assignmentId.length > 0,
    staleTime: OFFICE_STALE_MS,
    refetchInterval: (query) =>
      query.state.data?.status === "RUNNING" ? ACTIVE_RUN_POLL_MS : false,
    queryFn: () =>
      workspaceScopedFetch<OfficeAssignmentResource>(
        workspaceId,
        `/api/v1/office/assignments/${encodeURIComponent(assignmentId!)}`,
      ),
  });
}

export function useCreateOfficeAssignmentMutation() {
  const workspaceId = useWorkspaceQueryScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      readonly goalId?: string;
      readonly officeWorkerId: string;
      readonly title: string;
      readonly description?: string;
      readonly targetType: "AGENT_VERSION" | "WORKFLOW_VERSION";
      readonly targetVersionId: string;
      readonly input: unknown;
    }) => {
      const pinnedWorkspaceId = workspaceId;
      return workspaceMutationFetch<OfficeAssignmentResource>(
        "/api/v1/office/assignments",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        { workspaceId: pinnedWorkspaceId },
      );
    },
    onSuccess: () => {
      invalidateOfficeMissionsAndTasks(queryClient, workspaceId);
    },
  });
}

export function useUpdateOfficeAssignmentMutation(assignmentId: string) {
  const workspaceId = useWorkspaceQueryScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      readonly title?: string;
      readonly description?: string;
      readonly goalId?: string | null;
    }) => {
      const pinnedWorkspaceId = workspaceId;
      return workspaceMutationFetch<OfficeAssignmentResource>(
        `/api/v1/office/assignments/${encodeURIComponent(assignmentId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        { workspaceId: pinnedWorkspaceId },
      );
    },
    onSuccess: () => {
      invalidateOfficeMissionsAndTasks(queryClient, workspaceId);
    },
  });
}

export function useLaunchOfficeAssignmentMutation(assignmentId: string) {
  const workspaceId = useWorkspaceQueryScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => {
      const pinnedWorkspaceId = workspaceId;
      return workspaceMutationFetch<OfficeAssignmentResource>(
        `/api/v1/office/assignments/${encodeURIComponent(assignmentId)}/launch`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
        { workspaceId: pinnedWorkspaceId },
      );
    },
    onSuccess: () => {
      invalidateOfficeMissionsAndTasks(queryClient, workspaceId);
    },
  });
}

export function useCancelOfficeAssignmentMutation(assignmentId: string) {
  const workspaceId = useWorkspaceQueryScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => {
      const pinnedWorkspaceId = workspaceId;
      return workspaceMutationFetch<OfficeAssignmentResource>(
        `/api/v1/office/assignments/${encodeURIComponent(assignmentId)}/cancel`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
        { workspaceId: pinnedWorkspaceId },
      );
    },
    onSuccess: () => {
      invalidateOfficeMissionsAndTasks(queryClient, workspaceId);
    },
  });
}

/** Membership rows for every team — used for worker ↔ team links on dashboards. */
export function useAllTeamMembershipsQuery(
  teamIds: readonly string[] | undefined,
) {
  const workspaceId = useWorkspaceQueryScope();
  const enabled =
    workspaceId !== undefined && teamIds !== undefined && teamIds.length > 0;

  return useQueries({
    queries: (teamIds ?? []).map((teamId) => ({
      queryKey: ["office", workspaceId, "teams", teamId, "memberships"],
      enabled,
      staleTime: OFFICE_STALE_MS,
      queryFn: () =>
        workspaceScopedFetch<TeamMembershipListResource>(
          workspaceId,
          `/api/v1/office/teams/${encodeURIComponent(teamId)}/memberships`,
        ),
    })),
  });
}

export interface OfficeOverviewCounts {
  readonly workers: number;
  readonly teams: number;
  readonly pending: number;
  readonly running: number;
  readonly completed: number;
  readonly failed: number;
}

export function summarizeAssignmentCounts(
  assignments: readonly OfficeAssignmentResource[],
): Omit<OfficeOverviewCounts, "workers" | "teams"> {
  let pending = 0;
  let running = 0;
  let completed = 0;
  let failed = 0;
  for (const item of assignments) {
    switch (item.status) {
      case "PENDING":
        pending += 1;
        break;
      case "RUNNING":
        running += 1;
        break;
      case "COMPLETED":
        completed += 1;
        break;
      case "FAILED":
        failed += 1;
        break;
      default:
        break;
    }
  }
  return { pending, running, completed, failed };
}

export function recentAssignments(
  assignments: readonly OfficeAssignmentResource[],
  limit = 8,
): readonly OfficeAssignmentResource[] {
  return [...assignments]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, limit);
}
