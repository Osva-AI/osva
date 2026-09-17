import type {
  AssignmentId,
  AssignmentState,
  GoalId,
  OfficeWorkerId,
  RoleId,
  TeamId,
  WorkspaceId,
} from "@osva/contracts";

import type { Assignment } from "../assignment.js";
import type { Goal } from "../goal.js";
import type { OfficeWorker } from "../office-worker.js";
import type { Role } from "../role.js";
import type { Team } from "../team.js";
import type { TeamMembership } from "../team-membership.js";

export interface OfficeRepository {
  saveOfficeWorker(officeWorker: OfficeWorker): Promise<void>;
  findOfficeWorkerById(id: OfficeWorkerId): Promise<OfficeWorker | null>;
  listOfficeWorkersByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly OfficeWorker[]>;
  updateOfficeWorker(officeWorker: OfficeWorker): Promise<OfficeWorker | null>;

  saveRole(role: Role): Promise<void>;
  findRoleById(id: RoleId): Promise<Role | null>;
  listRolesByWorkspace(workspaceId: WorkspaceId): Promise<readonly Role[]>;
  updateRole(role: Role): Promise<Role | null>;

  saveTeam(team: Team): Promise<void>;
  findTeamById(id: TeamId): Promise<Team | null>;
  listTeamsByWorkspace(workspaceId: WorkspaceId): Promise<readonly Team[]>;
  updateTeam(team: Team): Promise<Team | null>;

  addTeamMembership(membership: TeamMembership): Promise<void>;
  findTeamMembership(
    teamId: TeamId,
    officeWorkerId: OfficeWorkerId,
  ): Promise<TeamMembership | null>;
  listTeamMembershipsByTeam(teamId: TeamId): Promise<readonly TeamMembership[]>;

  saveGoal(goal: Goal): Promise<void>;
  findGoalById(id: GoalId): Promise<Goal | null>;
  listGoalsByWorkspace(workspaceId: WorkspaceId): Promise<readonly Goal[]>;
  updateGoal(goal: Goal): Promise<Goal | null>;

  saveAssignment(assignment: Assignment): Promise<void>;
  findAssignmentById(id: AssignmentId): Promise<Assignment | null>;
  listAssignmentsByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly Assignment[]>;
  updateAssignment(assignment: Assignment): Promise<Assignment | null>;
  transitionAssignment(
    expectedStatus: AssignmentState,
    next: Assignment,
  ): Promise<Assignment>;
}
