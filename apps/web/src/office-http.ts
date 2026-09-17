import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AssignmentId,
  GoalId,
  OfficeWorkerId,
  RoleId,
  TeamId,
  WorkspaceId,
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
  listOfficeResourcesQuerySchema,
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
  if (route.kind === "officeWorkers") {
    if (method === "GET") {
      const workspaceId = parseWorkspaceQuery(searchParams, response);
      if (workspaceId === undefined) {
        return;
      }

      const list = await services.office.listOfficeWorkers.execute(workspaceId);
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

      const created = await services.office.createOfficeWorker.execute(
        parsed.data,
      );
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

      const updated = await services.office.updateOfficeWorker.execute({
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
      const workspaceId = parseWorkspaceQuery(searchParams, response);
      if (workspaceId === undefined) {
        return;
      }

      const list = await services.office.listRoles.execute(workspaceId);
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

      const created = await services.office.createRole.execute(parsed.data);
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
      const role = await services.office.getRole.execute(route.roleId);
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

      const updated = await services.office.updateRole.execute({
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
      const workspaceId = parseWorkspaceQuery(searchParams, response);
      if (workspaceId === undefined) {
        return;
      }

      const list = await services.office.listTeams.execute(workspaceId);
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

      const created = await services.office.createTeam.execute(parsed.data);
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
      const team = await services.office.getTeam.execute(route.teamId);
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

      const updated = await services.office.updateTeam.execute({
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

      const created = await services.office.addTeamMembership.execute({
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
      const workspaceId = parseWorkspaceQuery(searchParams, response);
      if (workspaceId === undefined) {
        return;
      }

      const list = await services.office.listGoals.execute(workspaceId);
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

      const created = await services.office.createGoal.execute(parsed.data);
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
      const goal = await services.office.getGoal.execute(route.goalId);
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

      const updated = await services.office.updateGoal.execute({
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
      const workspaceId = parseWorkspaceQuery(searchParams, response);
      if (workspaceId === undefined) {
        return;
      }

      const list = await services.office.listAssignments.execute(workspaceId);
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

      const created = await services.office.createAssignment.execute(
        parsed.data,
      );
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

      const updated = await services.office.updateAssignment.execute({
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
      route.assignmentId,
    );
    sendJson(response, 200, toAssignmentResource(cancelled));
  }
}

function matchOfficeRoute(path: string): OfficeRoute | undefined {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 2 || segments[0] !== "v1") {
    return undefined;
  }

  if (segments[1] === "office-workers") {
    if (segments.length === 2) {
      return { kind: "officeWorkers" };
    }

    if (segments.length === 3) {
      return {
        kind: "officeWorker",
        officeWorkerId: segments[2] as OfficeWorkerId,
      };
    }
  }

  if (segments[1] === "roles") {
    if (segments.length === 2) {
      return { kind: "roles" };
    }

    if (segments.length === 3) {
      return { kind: "role", roleId: segments[2] as RoleId };
    }
  }

  if (segments[1] === "teams") {
    if (segments.length === 2) {
      return { kind: "teams" };
    }

    if (segments.length === 3) {
      return { kind: "team", teamId: segments[2] as TeamId };
    }

    if (segments.length === 4 && segments[3] === "memberships") {
      return { kind: "teamMemberships", teamId: segments[2] as TeamId };
    }
  }

  if (segments[1] === "goals") {
    if (segments.length === 2) {
      return { kind: "goals" };
    }

    if (segments.length === 3) {
      return { kind: "goal", goalId: segments[2] as GoalId };
    }
  }

  if (segments[1] === "assignments") {
    if (segments.length === 2) {
      return { kind: "assignments" };
    }

    if (segments.length === 3) {
      return { kind: "assignment", assignmentId: segments[2] as AssignmentId };
    }

    if (segments.length === 4 && segments[3] === "launch") {
      return {
        kind: "assignmentLaunch",
        assignmentId: segments[2] as AssignmentId,
      };
    }

    if (segments.length === 4 && segments[3] === "cancel") {
      return {
        kind: "assignmentCancel",
        assignmentId: segments[2] as AssignmentId,
      };
    }
  }

  return undefined;
}

function parseWorkspaceQuery(
  searchParams: URLSearchParams,
  response: ServerResponse,
): WorkspaceId | undefined {
  const parsed = listOfficeResourcesQuerySchema.safeParse({
    workspaceId: searchParams.get("workspaceId") ?? undefined,
  });
  if (!parsed.success) {
    sendJson(response, 400, { status: "invalid_request" });
    return undefined;
  }

  return parsed.data.workspaceId as WorkspaceId;
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
