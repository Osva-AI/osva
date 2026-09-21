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

export class MemoryOfficeRepository implements OfficeRepository {
  private readonly officeWorkers = new Map<OfficeWorkerId, OfficeWorker>();
  private readonly roles = new Map<RoleId, Role>();
  private readonly teams = new Map<TeamId, Team>();
  private readonly memberships = new Map<string, TeamMembership>();
  private readonly goals = new Map<GoalId, Goal>();
  private readonly assignments = new Map<AssignmentId, Assignment>();

  async saveOfficeWorker(officeWorker: OfficeWorker): Promise<void> {
    for (const existing of this.officeWorkers.values()) {
      if (
        existing.id !== officeWorker.id &&
        existing.workspaceId === officeWorker.workspaceId &&
        existing.key === officeWorker.key
      ) {
        throw new DuplicateOfficeWorkerKeyError(
          officeWorker.workspaceId,
          officeWorker.key,
        );
      }
    }

    this.officeWorkers.set(officeWorker.id, officeWorker);
  }

  async findOfficeWorkerById(id: OfficeWorkerId): Promise<OfficeWorker | null> {
    return this.officeWorkers.get(id) ?? null;
  }

  async findOfficeWorkerByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: OfficeWorkerId,
  ): Promise<OfficeWorker | null> {
    const officeWorker = this.officeWorkers.get(id);
    if (
      officeWorker === undefined ||
      officeWorker.workspaceId !== workspaceId
    ) {
      return null;
    }

    return officeWorker;
  }

  async listOfficeWorkersByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly OfficeWorker[]> {
    return [...this.officeWorkers.values()]
      .filter((worker) => worker.workspaceId === workspaceId)
      .sort((left, right) => {
        const createdDelta =
          left.createdAt.getTime() - right.createdAt.getTime();
        return createdDelta !== 0
          ? createdDelta
          : left.id.localeCompare(right.id);
      });
  }

  async updateOfficeWorker(
    officeWorker: OfficeWorker,
  ): Promise<OfficeWorker | null> {
    if (!this.officeWorkers.has(officeWorker.id)) {
      return null;
    }

    this.officeWorkers.set(officeWorker.id, officeWorker);
    return officeWorker;
  }

  async saveRole(role: Role): Promise<void> {
    for (const existing of this.roles.values()) {
      if (
        existing.id !== role.id &&
        existing.workspaceId === role.workspaceId &&
        existing.key === role.key
      ) {
        throw new DuplicateRoleKeyError(role.workspaceId, role.key);
      }
    }

    this.roles.set(role.id, role);
  }

  async findRoleById(id: RoleId): Promise<Role | null> {
    return this.roles.get(id) ?? null;
  }

  async findRoleByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: RoleId,
  ): Promise<Role | null> {
    const role = this.roles.get(id);
    if (role === undefined || role.workspaceId !== workspaceId) {
      return null;
    }

    return role;
  }

  async listRolesByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly Role[]> {
    return [...this.roles.values()]
      .filter((role) => role.workspaceId === workspaceId)
      .sort((left, right) => {
        const createdDelta =
          left.createdAt.getTime() - right.createdAt.getTime();
        return createdDelta !== 0
          ? createdDelta
          : left.id.localeCompare(right.id);
      });
  }

  async updateRole(role: Role): Promise<Role | null> {
    if (!this.roles.has(role.id)) {
      return null;
    }

    this.roles.set(role.id, role);
    return role;
  }

  async saveTeam(team: Team): Promise<void> {
    for (const existing of this.teams.values()) {
      if (
        existing.id !== team.id &&
        existing.workspaceId === team.workspaceId &&
        existing.key === team.key
      ) {
        throw new DuplicateTeamKeyError(team.workspaceId, team.key);
      }
    }

    this.teams.set(team.id, team);
  }

  async findTeamById(id: TeamId): Promise<Team | null> {
    return this.teams.get(id) ?? null;
  }

  async findTeamByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: TeamId,
  ): Promise<Team | null> {
    const team = this.teams.get(id);
    if (team === undefined || team.workspaceId !== workspaceId) {
      return null;
    }

    return team;
  }

  async listTeamsByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly Team[]> {
    return [...this.teams.values()]
      .filter((team) => team.workspaceId === workspaceId)
      .sort((left, right) => {
        const createdDelta =
          left.createdAt.getTime() - right.createdAt.getTime();
        return createdDelta !== 0
          ? createdDelta
          : left.id.localeCompare(right.id);
      });
  }

  async updateTeam(team: Team): Promise<Team | null> {
    if (!this.teams.has(team.id)) {
      return null;
    }

    this.teams.set(team.id, team);
    return team;
  }

  async addTeamMembership(membership: TeamMembership): Promise<void> {
    const key = membershipKey(membership.teamId, membership.officeWorkerId);
    if (this.memberships.has(key)) {
      throw new DuplicateTeamMembershipError(
        membership.teamId,
        membership.officeWorkerId,
      );
    }

    this.memberships.set(key, membership);
  }

  async findTeamMembership(
    teamId: TeamId,
    officeWorkerId: OfficeWorkerId,
  ): Promise<TeamMembership | null> {
    return this.memberships.get(membershipKey(teamId, officeWorkerId)) ?? null;
  }

  async listTeamMembershipsByTeam(
    teamId: TeamId,
  ): Promise<readonly TeamMembership[]> {
    return [...this.memberships.values()]
      .filter((membership) => membership.teamId === teamId)
      .sort((left, right) =>
        left.officeWorkerId.localeCompare(right.officeWorkerId),
      );
  }

  async saveGoal(goal: Goal): Promise<void> {
    for (const existing of this.goals.values()) {
      if (
        existing.id !== goal.id &&
        existing.workspaceId === goal.workspaceId &&
        existing.key === goal.key
      ) {
        throw new DuplicateGoalKeyError(goal.workspaceId, goal.key);
      }
    }

    this.goals.set(goal.id, goal);
  }

  async findGoalById(id: GoalId): Promise<Goal | null> {
    return this.goals.get(id) ?? null;
  }

  async findGoalByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: GoalId,
  ): Promise<Goal | null> {
    const goal = this.goals.get(id);
    if (goal === undefined || goal.workspaceId !== workspaceId) {
      return null;
    }

    return goal;
  }

  async listGoalsByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly Goal[]> {
    return [...this.goals.values()]
      .filter((goal) => goal.workspaceId === workspaceId)
      .sort((left, right) => {
        const createdDelta =
          left.createdAt.getTime() - right.createdAt.getTime();
        return createdDelta !== 0
          ? createdDelta
          : left.id.localeCompare(right.id);
      });
  }

  async updateGoal(goal: Goal): Promise<Goal | null> {
    if (!this.goals.has(goal.id)) {
      return null;
    }

    this.goals.set(goal.id, goal);
    return goal;
  }

  async saveAssignment(assignment: Assignment): Promise<void> {
    this.assignments.set(assignment.id, assignment);
  }

  async findAssignmentById(id: AssignmentId): Promise<Assignment | null> {
    return this.assignments.get(id) ?? null;
  }

  async findAssignmentByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: AssignmentId,
  ): Promise<Assignment | null> {
    const assignment = this.assignments.get(id);
    if (assignment === undefined || assignment.workspaceId !== workspaceId) {
      return null;
    }

    return assignment;
  }

  async listAssignmentsByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly Assignment[]> {
    return [...this.assignments.values()]
      .filter((assignment) => assignment.workspaceId === workspaceId)
      .sort((left, right) => {
        const createdDelta =
          left.createdAt.getTime() - right.createdAt.getTime();
        return createdDelta !== 0
          ? createdDelta
          : left.id.localeCompare(right.id);
      });
  }

  async updateAssignment(assignment: Assignment): Promise<Assignment | null> {
    if (!this.assignments.has(assignment.id)) {
      return null;
    }

    this.assignments.set(assignment.id, assignment);
    return assignment;
  }

  async transitionAssignment(
    expectedStatus: AssignmentState,
    next: Assignment,
  ): Promise<Assignment> {
    assertLegalAssignmentTransition(expectedStatus, next.status);
    const existing = this.assignments.get(next.id);
    if (existing === undefined) {
      throw new AssignmentNotFoundError(next.id);
    }

    if (existing.status !== expectedStatus) {
      throw new LifecycleConflictError("assignment", next.id, expectedStatus);
    }

    this.assignments.set(next.id, next);
    return next;
  }
}

function membershipKey(teamId: TeamId, officeWorkerId: OfficeWorkerId): string {
  return `${teamId}:${officeWorkerId}`;
}
