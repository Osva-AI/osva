import type {
  AssignmentId,
  GoalId,
  JsonValue,
  OfficeWorkerId,
  RoleId,
  RunId,
  TeamId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva/contracts";
import {
  Assignment,
  Goal,
  OfficeWorker,
  Role,
  Team,
  TeamMembership,
} from "@osva/domain";

import type { assignments } from "../schema/assignments.js";
import type { goals } from "../schema/goals.js";
import type { officeWorkers } from "../schema/office-workers.js";
import type { roles } from "../schema/roles.js";
import type { teamMemberships } from "../schema/team-memberships.js";
import type { teams } from "../schema/teams.js";
import { toDomainDate } from "./timestamps.js";

type OfficeWorkerRow = typeof officeWorkers.$inferSelect;
type RoleRow = typeof roles.$inferSelect;
type TeamRow = typeof teams.$inferSelect;
type TeamMembershipRow = typeof teamMemberships.$inferSelect;
type GoalRow = typeof goals.$inferSelect;
type AssignmentRow = typeof assignments.$inferSelect;

export function officeWorkerToRow(officeWorker: OfficeWorker) {
  return {
    id: officeWorker.id,
    workspaceId: officeWorker.workspaceId,
    key: officeWorker.key,
    name: officeWorker.name,
    description: officeWorker.description ?? null,
    agentId: officeWorker.agentId,
    createdAt: officeWorker.createdAt,
    updatedAt: officeWorker.updatedAt,
  };
}

export function officeWorkerFromRow(row: OfficeWorkerRow): OfficeWorker {
  return OfficeWorker.rehydrate({
    id: row.id as OfficeWorkerId,
    workspaceId: row.workspaceId as WorkspaceId,
    key: row.key,
    name: row.name,
    description: row.description ?? undefined,
    agentId: row.agentId as OfficeWorker["agentId"],
    createdAt: toDomainDate(row.createdAt),
    updatedAt: toDomainDate(row.updatedAt),
  });
}

export function roleToRow(role: Role) {
  return {
    id: role.id,
    workspaceId: role.workspaceId,
    key: role.key,
    name: role.name,
    description: role.description ?? null,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

export function roleFromRow(row: RoleRow): Role {
  return Role.rehydrate({
    id: row.id as RoleId,
    workspaceId: row.workspaceId as WorkspaceId,
    key: row.key,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: toDomainDate(row.createdAt),
    updatedAt: toDomainDate(row.updatedAt),
  });
}

export function teamToRow(team: Team) {
  return {
    id: team.id,
    workspaceId: team.workspaceId,
    key: team.key,
    name: team.name,
    description: team.description ?? null,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
}

export function teamFromRow(row: TeamRow): Team {
  return Team.rehydrate({
    id: row.id as TeamId,
    workspaceId: row.workspaceId as WorkspaceId,
    key: row.key,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: toDomainDate(row.createdAt),
    updatedAt: toDomainDate(row.updatedAt),
  });
}

export function teamMembershipToRow(membership: TeamMembership) {
  return {
    teamId: membership.teamId,
    officeWorkerId: membership.officeWorkerId,
    roleId: membership.roleId ?? null,
  };
}

export function teamMembershipFromRow(row: TeamMembershipRow): TeamMembership {
  return TeamMembership.create({
    teamId: row.teamId as TeamId,
    officeWorkerId: row.officeWorkerId as OfficeWorkerId,
    roleId: row.roleId === null ? undefined : (row.roleId as RoleId),
  });
}

export function goalToRow(goal: Goal) {
  return {
    id: goal.id,
    workspaceId: goal.workspaceId,
    key: goal.key,
    title: goal.title,
    description: goal.description ?? null,
    status: goal.status,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  };
}

export function goalFromRow(row: GoalRow): Goal {
  return Goal.rehydrate({
    id: row.id as GoalId,
    workspaceId: row.workspaceId as WorkspaceId,
    key: row.key,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    createdAt: toDomainDate(row.createdAt),
    updatedAt: toDomainDate(row.updatedAt),
  });
}

export function assignmentToRow(assignment: Assignment) {
  return {
    id: assignment.id,
    workspaceId: assignment.workspaceId,
    goalId: assignment.goalId ?? null,
    officeWorkerId: assignment.officeWorkerId,
    title: assignment.title,
    description: assignment.description ?? null,
    targetType: assignment.targetType,
    targetVersionId: assignment.targetVersionId,
    input: assignment.input,
    status: assignment.status,
    runId: assignment.runId ?? null,
    workflowRunId: assignment.workflowRunId ?? null,
    createdAt: assignment.createdAt,
    startedAt: assignment.startedAt ?? null,
    completedAt: assignment.completedAt ?? null,
    cancelledAt: assignment.cancelledAt ?? null,
  };
}

export function assignmentFromRow(row: AssignmentRow): Assignment {
  return Assignment.rehydrate({
    id: row.id as AssignmentId,
    workspaceId: row.workspaceId as WorkspaceId,
    goalId: row.goalId === null ? undefined : (row.goalId as GoalId),
    officeWorkerId: row.officeWorkerId as OfficeWorkerId,
    title: row.title,
    description: row.description ?? undefined,
    targetType: row.targetType,
    targetVersionId: row.targetVersionId,
    input: row.input as JsonValue,
    status: row.status,
    runId: row.runId === null ? undefined : (row.runId as RunId),
    workflowRunId:
      row.workflowRunId === null
        ? undefined
        : (row.workflowRunId as WorkflowRunId),
    createdAt: toDomainDate(row.createdAt),
    startedAt: row.startedAt === null ? undefined : toDomainDate(row.startedAt),
    completedAt:
      row.completedAt === null ? undefined : toDomainDate(row.completedAt),
    cancelledAt:
      row.cancelledAt === null ? undefined : toDomainDate(row.cancelledAt),
  });
}
