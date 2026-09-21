import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AssignmentId,
  GoalId,
  OfficeWorkerId,
  RoleId,
  TeamId,
} from "@osva/contracts";
import type { RunAttemptId, RunId, WorkflowRunId } from "@osva/contracts";
import {
  addTeamMembershipRequestSchema,
  assignmentListResourceSchema,
  assignmentResourceSchema,
  createAssignmentRequestSchema,
  createGoalRequestSchema,
  createOfficeWorkerRequestSchema,
  createRoleRequestSchema,
  createTeamRequestSchema,
  goalListResourceSchema,
  goalResourceSchema,
  officeWorkerListResourceSchema,
  officeWorkerResourceSchema,
  roleListResourceSchema,
  roleResourceSchema,
  teamListResourceSchema,
  teamMembershipListResourceSchema,
  teamResourceSchema,
  updateAssignmentRequestSchema,
  updateGoalRequestSchema,
  updateOfficeWorkerRequestSchema,
  updateRoleRequestSchema,
  updateTeamRequestSchema,
} from "@osva/contracts/schemas";
import type {
  Assignment,
  Goal,
  OfficeApplication,
  OfficeWorker,
  Role,
  Team,
  TeamMembership,
} from "@osva/domain";
import type {
  LaunchAssignment,
  ReconcileAssignment,
} from "@osva/orchestration";

import { requireControlPlaneScope } from "./control-plane-http.js";
import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";

export interface OfficeHttpClock {
  now(): Date;
}

export interface OfficeHttpIds {
  createId(): string;
}

export interface OfficeHttpServices {
  readonly office: OfficeApplication;
  readonly launchAssignment: LaunchAssignment;
  readonly reconcileAssignment: ReconcileAssignment;
  readonly clock: OfficeHttpClock;
  readonly ids: OfficeHttpIds;
}

export async function handleOfficeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  searchParams: URLSearchParams,
  services: OfficeHttpServices,
): Promise<boolean> {
  const route = matchOfficeRoute(path);
  if (route === undefined) {
    return false;
  }

  try {
    await dispatchOfficeRoute(
      request,
      response,
      method,
      route,
      searchParams,
      services,
    );
  } catch (error) {
    sendHttpError(response, error);
  }

  return true;
}

type OfficeRoute =
  | { readonly kind: "officeWorkers" }
  | { readonly kind: "officeWorker"; readonly officeWorkerId: OfficeWorkerId }
  | { readonly kind: "roles" }
  | { readonly kind: "role"; readonly roleId: RoleId }
  | { readonly kind: "teams" }
  | { readonly kind: "team"; readonly teamId: TeamId }
  | { readonly kind: "teamMemberships"; readonly teamId: TeamId }
  | { readonly kind: "goals" }
  | { readonly kind: "goal"; readonly goalId: GoalId }
  | { readonly kind: "assignments" }
  | { readonly kind: "assignment"; readonly assignmentId: AssignmentId }
  | {
      readonly kind: "assignmentLaunch";
      readonly assignmentId: AssignmentId;
    }
  | {
      readonly kind: "assignmentCancel";
      readonly assignmentId: AssignmentId;
    };

async function dispatchOfficeRoute(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  route: OfficeRoute,
  searchParams: URLSearchParams,
  services: OfficeHttpServices,
): Promise<void> {
  const scope = requireControlPlaneScope();
  if (route.kind === "officeWorkers") {
    if (method === "GET") {
      const list = await services.office.listOfficeWorkers.execute(scope);
      sendJson(response, 200, toOfficeWorkerListResource(list));
      return;
    }

    if (method === "POST") {
      const parsed = createOfficeWorkerRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await services.office.createOfficeWorker.execute(scope, {
        ...parsed.data,
        workspaceId: scope.principal.workspaceId,
      });
      sendJson(response, 201, toOfficeWorkerResource(created));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, POST" },
    );
    return;
  }

  if (route.kind === "officeWorker") {
    if (method === "GET") {
      const worker = await services.office.getOfficeWorker.execute(
        scope,
        route.officeWorkerId,
      );
      sendJson(response, 200, toOfficeWorkerResource(worker));
      return;
    }

    if (method === "PATCH") {
      const parsed = updateOfficeWorkerRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const updated = await services.office.updateOfficeWorker.execute(scope, {
        officeWorkerId: route.officeWorkerId,
        ...parsed.data,
      });
      sendJson(response, 200, toOfficeWorkerResource(updated));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, PATCH" },
    );
    return;
  }

  if (route.kind === "roles") {
    if (method === "GET") {
      const list = await services.office.listRoles.execute(scope);
      sendJson(response, 200, toRoleListResource(list));
      return;
    }

    if (method === "POST") {
      const parsed = createRoleRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await services.office.createRole.execute(scope, {
        ...parsed.data,
        workspaceId: scope.principal.workspaceId,
      });
      sendJson(response, 201, toRoleResource(created));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, POST" },
    );
    return;
  }

  if (route.kind === "role") {
    if (method === "GET") {
      const role = await services.office.getRole.execute(scope, route.roleId);
      sendJson(response, 200, toRoleResource(role));
      return;
    }

    if (method === "PATCH") {
      const parsed = updateRoleRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const updated = await services.office.updateRole.execute(scope, {
        roleId: route.roleId,
        ...parsed.data,
      });
      sendJson(response, 200, toRoleResource(updated));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, PATCH" },
    );
    return;
  }

  if (route.kind === "teams") {
    if (method === "GET") {
      const list = await services.office.listTeams.execute(scope);
      sendJson(response, 200, toTeamListResource(list));
      return;
    }

    if (method === "POST") {
      const parsed = createTeamRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await services.office.createTeam.execute(scope, {
        ...parsed.data,
        workspaceId: scope.principal.workspaceId,
      });
      sendJson(response, 201, toTeamResource(created));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, POST" },
    );
    return;
  }

  if (route.kind === "team") {
    if (method === "GET") {
      const team = await services.office.getTeam.execute(scope, route.teamId);
      sendJson(response, 200, toTeamResource(team));
      return;
    }

    if (method === "PATCH") {
      const parsed = updateTeamRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const updated = await services.office.updateTeam.execute(scope, {
        teamId: route.teamId,
        ...parsed.data,
      });
      sendJson(response, 200, toTeamResource(updated));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, PATCH" },
    );
    return;
  }

  if (route.kind === "teamMemberships") {
    if (method === "GET") {
      const memberships = await services.office.listTeamMemberships.execute(
        scope,
        route.teamId,
      );
      sendJson(response, 200, toTeamMembershipListResource(memberships));
      return;
    }

    if (method === "POST") {
      const parsed = addTeamMembershipRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await services.office.addTeamMembership.execute(scope, {
        teamId: route.teamId,
        ...parsed.data,
      });
      sendJson(response, 201, toTeamMembershipResource(created));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, POST" },
    );
    return;
  }

  if (route.kind === "goals") {
    if (method === "GET") {
      const list = await services.office.listGoals.execute(scope);
      sendJson(response, 200, toGoalListResource(list));
      return;
    }

    if (method === "POST") {
      const parsed = createGoalRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await services.office.createGoal.execute(scope, {
        ...parsed.data,
        workspaceId: scope.principal.workspaceId,
      });
      sendJson(response, 201, toGoalResource(created));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, POST" },
    );
    return;
  }

  if (route.kind === "goal") {
    if (method === "GET") {
      const goal = await services.office.getGoal.execute(scope, route.goalId);
      sendJson(response, 200, toGoalResource(goal));
      return;
    }

    if (method === "PATCH") {
      const parsed = updateGoalRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const updated = await services.office.updateGoal.execute(scope, {
        goalId: route.goalId,
        ...parsed.data,
      });
      sendJson(response, 200, toGoalResource(updated));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, PATCH" },
    );
    return;
  }

  if (route.kind === "assignments") {
    if (method === "GET") {
      const list = await services.office.listAssignments.execute(scope);
      sendJson(response, 200, toAssignmentListResource(list));
      return;
    }

    if (method === "POST") {
      const parsed = createAssignmentRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const created = await services.office.createAssignment.execute(scope, {
        ...parsed.data,
        workspaceId: scope.principal.workspaceId,
      });
      sendJson(response, 201, toAssignmentResource(created));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, POST" },
    );
    return;
  }

  if (route.kind === "assignment") {
    if (method === "GET") {
      const assignment = await services.reconcileAssignment.execute({
        assignmentId: route.assignmentId,
        now: services.clock.now(),
      });
      sendJson(response, 200, toAssignmentResource(assignment));
      return;
    }

    if (method === "PATCH") {
      const parsed = updateAssignmentRequestSchema.safeParse(
        await readJsonBody(request),
      );
      if (!parsed.success) {
        sendJson(response, 400, { status: "invalid_request" });
        return;
      }

      const updated = await services.office.updateAssignment.execute(scope, {
        assignmentId: route.assignmentId,
        ...parsed.data,
      });
      sendJson(response, 200, toAssignmentResource(updated));
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, PATCH" },
    );
    return;
  }

  if (route.kind === "assignmentLaunch") {
    if (method !== "POST") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "POST" },
      );
      return;
    }

    const launched = await services.launchAssignment.execute({
      assignmentId: route.assignmentId,
      runId: services.ids.createId() as RunId,
      runAttemptId: services.ids.createId() as RunAttemptId,
      workflowRunId: services.ids.createId() as WorkflowRunId,
      now: services.clock.now(),
    });
    sendJson(response, 200, toAssignmentResource(launched));
    return;
  }

  if (route.kind === "assignmentCancel") {
    if (method !== "POST") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "POST" },
      );
      return;
    }

    const cancelled = await services.office.cancelAssignment.execute(
      scope,
      route.assignmentId,
    );
    sendJson(response, 200, toAssignmentResource(cancelled));
  }
}

function matchOfficeRoute(path: string): OfficeRoute | undefined {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 3 || segments[0] !== "v1" || segments[1] !== "office") {
    return undefined;
  }

  const resource = segments[2];

  if (resource === "workers") {
    if (segments.length === 3) {
      return { kind: "officeWorkers" };
    }

    if (segments.length === 4) {
      return {
        kind: "officeWorker",
        officeWorkerId: segments[3] as OfficeWorkerId,
      };
    }
  }

  if (resource === "roles") {
    if (segments.length === 3) {
      return { kind: "roles" };
    }

    if (segments.length === 4) {
      return { kind: "role", roleId: segments[3] as RoleId };
    }
  }

  if (resource === "teams") {
    if (segments.length === 3) {
      return { kind: "teams" };
    }

    if (segments.length === 4) {
      return { kind: "team", teamId: segments[3] as TeamId };
    }

    if (segments.length === 5 && segments[4] === "memberships") {
      return { kind: "teamMemberships", teamId: segments[3] as TeamId };
    }
  }

  if (resource === "goals") {
    if (segments.length === 3) {
      return { kind: "goals" };
    }

    if (segments.length === 4) {
      return { kind: "goal", goalId: segments[3] as GoalId };
    }
  }

  if (resource === "assignments") {
    if (segments.length === 3) {
      return { kind: "assignments" };
    }

    if (segments.length === 4) {
      return {
        kind: "assignment",
        assignmentId: segments[3] as AssignmentId,
      };
    }

    if (segments.length === 5 && segments[4] === "launch") {
      return {
        kind: "assignmentLaunch",
        assignmentId: segments[3] as AssignmentId,
      };
    }

    if (segments.length === 5 && segments[4] === "cancel") {
      return {
        kind: "assignmentCancel",
        assignmentId: segments[3] as AssignmentId,
      };
    }
  }

  return undefined;
}

function toOfficeWorkerResource(worker: OfficeWorker) {
  return officeWorkerResourceSchema.parse({
    id: worker.id,
    workspaceId: worker.workspaceId,
    key: worker.key,
    name: worker.name,
    description: worker.description,
    agentId: worker.agentId,
    createdAt: worker.createdAt.toISOString(),
    updatedAt: worker.updatedAt.toISOString(),
  });
}

function toOfficeWorkerListResource(workers: readonly OfficeWorker[]) {
  return officeWorkerListResourceSchema.parse({
    items: workers.map(toOfficeWorkerResource),
  });
}

function toRoleResource(role: Role) {
  return roleResourceSchema.parse({
    id: role.id,
    workspaceId: role.workspaceId,
    key: role.key,
    name: role.name,
    description: role.description,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  });
}

function toRoleListResource(roles: readonly Role[]) {
  return roleListResourceSchema.parse({
    items: roles.map(toRoleResource),
  });
}

function toTeamResource(team: Team) {
  return teamResourceSchema.parse({
    id: team.id,
    workspaceId: team.workspaceId,
    key: team.key,
    name: team.name,
    description: team.description,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
  });
}

function toTeamListResource(teams: readonly Team[]) {
  return teamListResourceSchema.parse({
    items: teams.map(toTeamResource),
  });
}

function toTeamMembershipResource(membership: TeamMembership) {
  return {
    teamId: membership.teamId,
    officeWorkerId: membership.officeWorkerId,
    roleId: membership.roleId,
  };
}

function toTeamMembershipListResource(memberships: readonly TeamMembership[]) {
  return teamMembershipListResourceSchema.parse({
    items: memberships.map(toTeamMembershipResource),
  });
}

function toGoalResource(goal: Goal) {
  return goalResourceSchema.parse({
    id: goal.id,
    workspaceId: goal.workspaceId,
    key: goal.key,
    title: goal.title,
    description: goal.description,
    status: goal.status,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  });
}

function toGoalListResource(goals: readonly Goal[]) {
  return goalListResourceSchema.parse({
    items: goals.map(toGoalResource),
  });
}

function toAssignmentResource(assignment: Assignment) {
  return assignmentResourceSchema.parse({
    id: assignment.id,
    workspaceId: assignment.workspaceId,
    goalId: assignment.goalId,
    officeWorkerId: assignment.officeWorkerId,
    title: assignment.title,
    description: assignment.description,
    targetType: assignment.targetType,
    targetVersionId: assignment.targetVersionId,
    input: assignment.input,
    status: assignment.status,
    runId: assignment.runId,
    workflowRunId: assignment.workflowRunId,
    createdAt: assignment.createdAt.toISOString(),
    startedAt: assignment.startedAt?.toISOString(),
    completedAt: assignment.completedAt?.toISOString(),
    cancelledAt: assignment.cancelledAt?.toISOString(),
  });
}

function toAssignmentListResource(assignments: readonly Assignment[]) {
  return assignmentListResourceSchema.parse({
    items: assignments.map(toAssignmentResource),
  });
}
export const V1_HTTP_ROUTES = [
  { method: "GET", path: "/v1/office/workers" },
  { method: "POST", path: "/v1/office/workers" },
  { method: "GET", path: "/v1/office/workers/:officeWorkerId" },
  { method: "PATCH", path: "/v1/office/workers/:officeWorkerId" },
  { method: "GET", path: "/v1/office/roles" },
  { method: "POST", path: "/v1/office/roles" },
  { method: "GET", path: "/v1/office/roles/:roleId" },
  { method: "PATCH", path: "/v1/office/roles/:roleId" },
  { method: "GET", path: "/v1/office/teams" },
  { method: "POST", path: "/v1/office/teams" },
  { method: "GET", path: "/v1/office/teams/:teamId" },
  { method: "PATCH", path: "/v1/office/teams/:teamId" },
  { method: "GET", path: "/v1/office/teams/:teamId/memberships" },
  { method: "POST", path: "/v1/office/teams/:teamId/memberships" },
  { method: "GET", path: "/v1/office/goals" },
  { method: "POST", path: "/v1/office/goals" },
  { method: "GET", path: "/v1/office/goals/:goalId" },
  { method: "PATCH", path: "/v1/office/goals/:goalId" },
  { method: "GET", path: "/v1/office/assignments" },
  { method: "POST", path: "/v1/office/assignments" },
  { method: "GET", path: "/v1/office/assignments/:assignmentId" },
  { method: "PATCH", path: "/v1/office/assignments/:assignmentId" },
  { method: "POST", path: "/v1/office/assignments/:assignmentId/launch" },
  { method: "POST", path: "/v1/office/assignments/:assignmentId/cancel" },
] as const;
