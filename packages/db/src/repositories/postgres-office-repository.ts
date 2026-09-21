import type {
  AssignmentId,
  AssignmentState,
  GoalId,
  OfficeWorkerId,
  RoleId,
  TeamId,
  WorkspaceId,
} from "@osva/contracts";
import {
  assertLegalAssignmentTransition,
  AssignmentNotFoundError,
  DuplicateGoalKeyError,
  DuplicateOfficeWorkerKeyError,
  DuplicateRoleKeyError,
  DuplicateTeamKeyError,
  DuplicateTeamMembershipError,
  LifecycleConflictError,
  type Assignment,
  type Goal,
  type OfficeRepository,
  type OfficeWorker,
  type Role,
  type Team,
  type TeamMembership,
} from "@osva/domain";
import { and, asc, eq } from "drizzle-orm";

import type { Database } from "../database.js";
import {
  assignmentFromRow,
  assignmentToRow,
  goalFromRow,
  goalToRow,
  officeWorkerFromRow,
  officeWorkerToRow,
  roleFromRow,
  roleToRow,
  teamFromRow,
  teamMembershipFromRow,
  teamMembershipToRow,
  teamToRow,
} from "../mappers/office-mapper.js";
import {
  POSTGRES_UNIQUE_VIOLATION,
  mapDatabaseError,
  postgresConstraintName,
  postgresErrorCode,
} from "../postgres-errors.js";
import { assignments } from "../schema/assignments.js";
import { goals } from "../schema/goals.js";
import { officeWorkers } from "../schema/office-workers.js";
import { roles } from "../schema/roles.js";
import { teamMemberships } from "../schema/team-memberships.js";
import { teams } from "../schema/teams.js";

export class PostgresOfficeRepository implements OfficeRepository {
  constructor(private readonly database: Database) {}

  async saveOfficeWorker(officeWorker: OfficeWorker): Promise<void> {
    const row = officeWorkerToRow(officeWorker);

    try {
      await this.database.db.insert(officeWorkers).values(row);
    } catch (error) {
      if (
        postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION &&
        postgresConstraintName(error) ===
          "office_workers_workspace_id_key_unique"
      ) {
        throw new DuplicateOfficeWorkerKeyError(
          officeWorker.workspaceId,
          officeWorker.key,
        );
      }

      throw mapDatabaseError(error, {
        office_workers_workspace_id_key_unique: `OfficeWorker key '${officeWorker.key}' already exists in workspace '${officeWorker.workspaceId}'.`,
      });
    }
  }

  async findOfficeWorkerById(id: OfficeWorkerId): Promise<OfficeWorker | null> {
    const [row] = await this.database.db
      .select()
      .from(officeWorkers)
      .where(eq(officeWorkers.id, id))
      .limit(1);

    return row === undefined ? null : officeWorkerFromRow(row);
  }

  async findOfficeWorkerByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: OfficeWorkerId,
  ): Promise<OfficeWorker | null> {
    const [row] = await this.database.db
      .select()
      .from(officeWorkers)
      .where(
        and(
          eq(officeWorkers.id, id),
          eq(officeWorkers.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    return row === undefined ? null : officeWorkerFromRow(row);
  }

  async listOfficeWorkersByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly OfficeWorker[]> {
    const rows = await this.database.db
      .select()
      .from(officeWorkers)
      .where(eq(officeWorkers.workspaceId, workspaceId))
      .orderBy(asc(officeWorkers.createdAt), asc(officeWorkers.id));

    return rows.map(officeWorkerFromRow);
  }

  async updateOfficeWorker(
    officeWorker: OfficeWorker,
  ): Promise<OfficeWorker | null> {
    const row = officeWorkerToRow(officeWorker);
    const [updated] = await this.database.db
      .update(officeWorkers)
      .set({
        name: row.name,
        description: row.description,
        updatedAt: row.updatedAt,
      })
      .where(eq(officeWorkers.id, officeWorker.id))
      .returning();

    return updated === undefined ? null : officeWorkerFromRow(updated);
  }

  async saveRole(role: Role): Promise<void> {
    const row = roleToRow(role);

    try {
      await this.database.db.insert(roles).values(row);
    } catch (error) {
      if (
        postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION &&
        postgresConstraintName(error) === "roles_workspace_id_key_unique"
      ) {
        throw new DuplicateRoleKeyError(role.workspaceId, role.key);
      }

      throw mapDatabaseError(error, {
        roles_workspace_id_key_unique: `Role key '${role.key}' already exists in workspace '${role.workspaceId}'.`,
      });
    }
  }

  async findRoleById(id: RoleId): Promise<Role | null> {
    const [row] = await this.database.db
      .select()
      .from(roles)
      .where(eq(roles.id, id))
      .limit(1);

    return row === undefined ? null : roleFromRow(row);
  }

  async findRoleByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: RoleId,
  ): Promise<Role | null> {
    const [row] = await this.database.db
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), eq(roles.workspaceId, workspaceId)))
      .limit(1);

    return row === undefined ? null : roleFromRow(row);
  }

  async listRolesByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly Role[]> {
    const rows = await this.database.db
      .select()
      .from(roles)
      .where(eq(roles.workspaceId, workspaceId))
      .orderBy(asc(roles.createdAt), asc(roles.id));

    return rows.map(roleFromRow);
  }

  async updateRole(role: Role): Promise<Role | null> {
    const row = roleToRow(role);
    const [updated] = await this.database.db
      .update(roles)
      .set({
        name: row.name,
        description: row.description,
        updatedAt: row.updatedAt,
      })
      .where(eq(roles.id, role.id))
      .returning();

    return updated === undefined ? null : roleFromRow(updated);
  }

  async saveTeam(team: Team): Promise<void> {
    const row = teamToRow(team);

    try {
      await this.database.db.insert(teams).values(row);
    } catch (error) {
      if (
        postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION &&
        postgresConstraintName(error) === "teams_workspace_id_key_unique"
      ) {
        throw new DuplicateTeamKeyError(team.workspaceId, team.key);
      }

      throw mapDatabaseError(error, {
        teams_workspace_id_key_unique: `Team key '${team.key}' already exists in workspace '${team.workspaceId}'.`,
      });
    }
  }

  async findTeamById(id: TeamId): Promise<Team | null> {
    const [row] = await this.database.db
      .select()
      .from(teams)
      .where(eq(teams.id, id))
      .limit(1);

    return row === undefined ? null : teamFromRow(row);
  }

  async findTeamByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: TeamId,
  ): Promise<Team | null> {
    const [row] = await this.database.db
      .select()
      .from(teams)
      .where(and(eq(teams.id, id), eq(teams.workspaceId, workspaceId)))
      .limit(1);

    return row === undefined ? null : teamFromRow(row);
  }

  async listTeamsByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly Team[]> {
    const rows = await this.database.db
      .select()
      .from(teams)
      .where(eq(teams.workspaceId, workspaceId))
      .orderBy(asc(teams.createdAt), asc(teams.id));

    return rows.map(teamFromRow);
  }

  async updateTeam(team: Team): Promise<Team | null> {
    const row = teamToRow(team);
    const [updated] = await this.database.db
      .update(teams)
      .set({
        name: row.name,
        description: row.description,
        updatedAt: row.updatedAt,
      })
      .where(eq(teams.id, team.id))
      .returning();

    return updated === undefined ? null : teamFromRow(updated);
  }

  async addTeamMembership(membership: TeamMembership): Promise<void> {
    const row = teamMembershipToRow(membership);

    try {
      await this.database.db.insert(teamMemberships).values(row);
    } catch (error) {
      if (
        postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION &&
        postgresConstraintName(error) ===
          "team_memberships_team_id_office_worker_id_unique"
      ) {
        throw new DuplicateTeamMembershipError(
          membership.teamId,
          membership.officeWorkerId,
        );
      }

      throw mapDatabaseError(error, {
        team_memberships_team_id_office_worker_id_unique: `OfficeWorker ${membership.officeWorkerId} is already a member of Team ${membership.teamId}.`,
      });
    }
  }

  async findTeamMembership(
    teamId: TeamId,
    officeWorkerId: OfficeWorkerId,
  ): Promise<TeamMembership | null> {
    const [row] = await this.database.db
      .select()
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.teamId, teamId),
          eq(teamMemberships.officeWorkerId, officeWorkerId),
        ),
      )
      .limit(1);

    return row === undefined ? null : teamMembershipFromRow(row);
  }

  async listTeamMembershipsByTeam(
    teamId: TeamId,
  ): Promise<readonly TeamMembership[]> {
    const rows = await this.database.db
      .select()
      .from(teamMemberships)
      .where(eq(teamMemberships.teamId, teamId))
      .orderBy(asc(teamMemberships.officeWorkerId));

    return rows.map(teamMembershipFromRow);
  }

  async saveGoal(goal: Goal): Promise<void> {
    const row = goalToRow(goal);

    try {
      await this.database.db.insert(goals).values(row);
    } catch (error) {
      if (
        postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION &&
        postgresConstraintName(error) === "goals_workspace_id_key_unique"
      ) {
        throw new DuplicateGoalKeyError(goal.workspaceId, goal.key);
      }

      throw mapDatabaseError(error, {
        goals_workspace_id_key_unique: `Goal key '${goal.key}' already exists in workspace '${goal.workspaceId}'.`,
      });
    }
  }

  async findGoalById(id: GoalId): Promise<Goal | null> {
    const [row] = await this.database.db
      .select()
      .from(goals)
      .where(eq(goals.id, id))
      .limit(1);

    return row === undefined ? null : goalFromRow(row);
  }

  async findGoalByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: GoalId,
  ): Promise<Goal | null> {
    const [row] = await this.database.db
      .select()
      .from(goals)
      .where(and(eq(goals.id, id), eq(goals.workspaceId, workspaceId)))
      .limit(1);

    return row === undefined ? null : goalFromRow(row);
  }

  async listGoalsByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly Goal[]> {
    const rows = await this.database.db
      .select()
      .from(goals)
      .where(eq(goals.workspaceId, workspaceId))
      .orderBy(asc(goals.createdAt), asc(goals.id));

    return rows.map(goalFromRow);
  }

  async updateGoal(goal: Goal): Promise<Goal | null> {
    const row = goalToRow(goal);
    const [updated] = await this.database.db
      .update(goals)
      .set({
        title: row.title,
        description: row.description,
        status: row.status,
        updatedAt: row.updatedAt,
      })
      .where(eq(goals.id, goal.id))
      .returning();

    return updated === undefined ? null : goalFromRow(updated);
  }

  async saveAssignment(assignment: Assignment): Promise<void> {
    const row = assignmentToRow(assignment);
    await this.database.db.insert(assignments).values(row);
  }

  async findAssignmentById(id: AssignmentId): Promise<Assignment | null> {
    const [row] = await this.database.db
      .select()
      .from(assignments)
      .where(eq(assignments.id, id))
      .limit(1);

    return row === undefined ? null : assignmentFromRow(row);
  }

  async findAssignmentByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: AssignmentId,
  ): Promise<Assignment | null> {
    const [row] = await this.database.db
      .select()
      .from(assignments)
      .where(
        and(eq(assignments.id, id), eq(assignments.workspaceId, workspaceId)),
      )
      .limit(1);

    return row === undefined ? null : assignmentFromRow(row);
  }

  async listAssignmentsByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly Assignment[]> {
    const rows = await this.database.db
      .select()
      .from(assignments)
      .where(eq(assignments.workspaceId, workspaceId))
      .orderBy(asc(assignments.createdAt), asc(assignments.id));

    return rows.map(assignmentFromRow);
  }

  async updateAssignment(assignment: Assignment): Promise<Assignment | null> {
    const row = assignmentToRow(assignment);
    const [updated] = await this.database.db
      .update(assignments)
      .set({
        goalId: row.goalId,
        title: row.title,
        description: row.description,
        status: row.status,
        runId: row.runId,
        workflowRunId: row.workflowRunId,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        cancelledAt: row.cancelledAt,
      })
      .where(eq(assignments.id, assignment.id))
      .returning();

    return updated === undefined ? null : assignmentFromRow(updated);
  }

  async transitionAssignment(
    expectedStatus: AssignmentState,
    next: Assignment,
  ): Promise<Assignment> {
    assertLegalAssignmentTransition(expectedStatus, next.status);
    const rowValues = assignmentToRow(next);

    const [row] = await this.database.db
      .update(assignments)
      .set({
        status: rowValues.status,
        runId: rowValues.runId,
        workflowRunId: rowValues.workflowRunId,
        startedAt: rowValues.startedAt,
        completedAt: rowValues.completedAt,
        cancelledAt: rowValues.cancelledAt,
      })
      .where(
        and(
          eq(assignments.id, next.id),
          eq(assignments.status, expectedStatus),
        ),
      )
      .returning();

    if (row !== undefined) {
      return assignmentFromRow(row);
    }

    const existing = await this.findAssignmentById(next.id);
    if (existing === null) {
      throw new AssignmentNotFoundError(next.id);
    }

    throw new LifecycleConflictError("assignment", next.id, expectedStatus);
  }
}
