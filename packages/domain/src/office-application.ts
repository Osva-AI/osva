import type {
  AgentId,
  AgentVersionId,
  AssignmentId,
  AssignmentTargetType,
  GoalId,
  JsonValue,
  OfficeWorkerId,
  RoleId,
  TeamId,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva/contracts";

import { Assignment } from "./assignment.js";
import {
  AgentNotFoundError,
  AgentVersionNotFoundError,
  AssignmentNotFoundError,
  DomainInvariantError,
  GoalNotFoundError,
  OfficeWorkerNotFoundError,
  RoleNotFoundError,
  TeamNotFoundError,
  WorkflowVersionNotFoundError,
  WorkspaceNotFoundError,
} from "./errors.js";
import { Goal } from "./goal.js";
import { OfficeWorker } from "./office-worker.js";
import type { AgentRepository } from "./ports/agent-repository.js";
import type { OfficeRepository } from "./ports/office-repository.js";
import type { WorkflowRepository } from "./ports/workflow-repository.js";
import type { WorkspaceRepository } from "./ports/workspace-repository.js";
import { Role } from "./role.js";
import { Team } from "./team.js";
import { TeamMembership } from "./team-membership.js";

export interface OfficeApplicationClock {
  now(): Date;
}

export interface OfficeApplicationIds {
  createId(): string;
}

export interface OfficeApplicationDependencies {
  readonly office: OfficeRepository;
  readonly workspaces: WorkspaceRepository;
  readonly agents: AgentRepository;
  readonly workflows: WorkflowRepository;
  readonly clock: OfficeApplicationClock;
  readonly ids: OfficeApplicationIds;
}

export interface CreateOfficeWorkerCommand {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly agentId: AgentId;
}

export interface UpdateOfficeWorkerCommand {
  readonly officeWorkerId: OfficeWorkerId;
  readonly name?: string;
  readonly description?: string;
}

export interface CreateRoleCommand {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
}

export interface UpdateRoleCommand {
  readonly roleId: RoleId;
  readonly name?: string;
  readonly description?: string;
}

export interface CreateTeamCommand {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
}

export interface UpdateTeamCommand {
  readonly teamId: TeamId;
  readonly name?: string;
  readonly description?: string;
}

export interface AddTeamMembershipCommand {
  readonly teamId: TeamId;
  readonly officeWorkerId: OfficeWorkerId;
  readonly roleId?: RoleId;
}

export interface CreateGoalCommand {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly title: string;
  readonly description?: string;
}

export interface UpdateGoalCommand {
  readonly goalId: GoalId;
  readonly title?: string;
  readonly description?: string;
  readonly status?: Goal["status"];
}

export interface CreateAssignmentCommand {
  readonly workspaceId: WorkspaceId;
  readonly goalId?: GoalId;
  readonly officeWorkerId: OfficeWorkerId;
  readonly title: string;
  readonly description?: string;
  readonly targetType: AssignmentTargetType;
  readonly targetVersionId: string;
  readonly input: JsonValue;
}

export interface UpdateAssignmentCommand {
  readonly assignmentId: AssignmentId;
  readonly title?: string;
  readonly description?: string;
  readonly goalId?: GoalId | null;
}

export class CreateOfficeWorker {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(command: CreateOfficeWorkerCommand): Promise<OfficeWorker> {
    await assertWorkspaceExists(this.deps.workspaces, command.workspaceId);
    await assertAgentInWorkspace(
      this.deps.agents,
      command.workspaceId,
      command.agentId,
    );

    const officeWorker = OfficeWorker.create({
      id: this.deps.ids.createId() as OfficeWorkerId,
      workspaceId: command.workspaceId,
      key: command.key,
      name: command.name,
      description: command.description,
      agentId: command.agentId,
      now: this.deps.clock.now(),
    });

    await this.deps.office.saveOfficeWorker(officeWorker);
    return officeWorker;
  }
}

export class GetOfficeWorker {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(officeWorkerId: OfficeWorkerId): Promise<OfficeWorker> {
    const officeWorker =
      await this.deps.office.findOfficeWorkerById(officeWorkerId);
    if (officeWorker === null) {
      throw new OfficeWorkerNotFoundError(officeWorkerId);
    }

    return officeWorker;
  }
}

export class ListOfficeWorkers {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(workspaceId: WorkspaceId): Promise<readonly OfficeWorker[]> {
    await assertWorkspaceExists(this.deps.workspaces, workspaceId);
    return this.deps.office.listOfficeWorkersByWorkspace(workspaceId);
  }
}

export class UpdateOfficeWorker {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(command: UpdateOfficeWorkerCommand): Promise<OfficeWorker> {
    const existing = await this.deps.office.findOfficeWorkerById(
      command.officeWorkerId,
    );
    if (existing === null) {
      throw new OfficeWorkerNotFoundError(command.officeWorkerId);
    }

    const updated = existing.update({
      name: command.name,
      description: command.description,
      now: this.deps.clock.now(),
    });
    const persisted = await this.deps.office.updateOfficeWorker(updated);
    if (persisted === null) {
      throw new OfficeWorkerNotFoundError(command.officeWorkerId);
    }

    return persisted;
  }
}

export class CreateRole {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(command: CreateRoleCommand): Promise<Role> {
    await assertWorkspaceExists(this.deps.workspaces, command.workspaceId);

    const role = Role.create({
      id: this.deps.ids.createId() as RoleId,
      workspaceId: command.workspaceId,
      key: command.key,
      name: command.name,
      description: command.description,
      now: this.deps.clock.now(),
    });

    await this.deps.office.saveRole(role);
    return role;
  }
}

export class GetRole {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(roleId: RoleId): Promise<Role> {
    const role = await this.deps.office.findRoleById(roleId);
    if (role === null) {
      throw new RoleNotFoundError(roleId);
    }

    return role;
  }
}

export class ListRoles {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(workspaceId: WorkspaceId): Promise<readonly Role[]> {
    await assertWorkspaceExists(this.deps.workspaces, workspaceId);
    return this.deps.office.listRolesByWorkspace(workspaceId);
  }
}

export class UpdateRole {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(command: UpdateRoleCommand): Promise<Role> {
    const existing = await this.deps.office.findRoleById(command.roleId);
    if (existing === null) {
      throw new RoleNotFoundError(command.roleId);
    }

    const updated = existing.update({
      name: command.name,
      description: command.description,
      now: this.deps.clock.now(),
    });
    const persisted = await this.deps.office.updateRole(updated);
    if (persisted === null) {
      throw new RoleNotFoundError(command.roleId);
    }

    return persisted;
  }
}

export class CreateTeam {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(command: CreateTeamCommand): Promise<Team> {
    await assertWorkspaceExists(this.deps.workspaces, command.workspaceId);

    const team = Team.create({
      id: this.deps.ids.createId() as TeamId,
      workspaceId: command.workspaceId,
      key: command.key,
      name: command.name,
      description: command.description,
      now: this.deps.clock.now(),
    });

    await this.deps.office.saveTeam(team);
    return team;
  }
}

export class GetTeam {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(teamId: TeamId): Promise<Team> {
    const team = await this.deps.office.findTeamById(teamId);
    if (team === null) {
      throw new TeamNotFoundError(teamId);
    }

    return team;
  }
}

export class ListTeams {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(workspaceId: WorkspaceId): Promise<readonly Team[]> {
    await assertWorkspaceExists(this.deps.workspaces, workspaceId);
    return this.deps.office.listTeamsByWorkspace(workspaceId);
  }
}

export class UpdateTeam {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(command: UpdateTeamCommand): Promise<Team> {
    const existing = await this.deps.office.findTeamById(command.teamId);
    if (existing === null) {
      throw new TeamNotFoundError(command.teamId);
    }

    const updated = existing.update({
      name: command.name,
      description: command.description,
      now: this.deps.clock.now(),
    });
    const persisted = await this.deps.office.updateTeam(updated);
    if (persisted === null) {
      throw new TeamNotFoundError(command.teamId);
    }

    return persisted;
  }
}

export class AddTeamMembership {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(command: AddTeamMembershipCommand): Promise<TeamMembership> {
    const team = await this.deps.office.findTeamById(command.teamId);
    if (team === null) {
      throw new TeamNotFoundError(command.teamId);
    }

    const officeWorker = await this.deps.office.findOfficeWorkerById(
      command.officeWorkerId,
    );
    if (officeWorker === null) {
      throw new OfficeWorkerNotFoundError(command.officeWorkerId);
    }

    if (officeWorker.workspaceId !== team.workspaceId) {
      throw new DomainInvariantError(
        `OfficeWorker ${officeWorker.id} belongs to workspace ${officeWorker.workspaceId}, not ${team.workspaceId}.`,
      );
    }

    if (command.roleId !== undefined) {
      const role = await this.deps.office.findRoleById(command.roleId);
      if (role === null) {
        throw new RoleNotFoundError(command.roleId);
      }

      if (role.workspaceId !== team.workspaceId) {
        throw new DomainInvariantError(
          `Role ${role.id} belongs to workspace ${role.workspaceId}, not ${team.workspaceId}.`,
        );
      }
    }

    const membership = TeamMembership.create({
      teamId: command.teamId,
      officeWorkerId: command.officeWorkerId,
      roleId: command.roleId,
    });

    await this.deps.office.addTeamMembership(membership);
    return membership;
  }
}

export class ListTeamMemberships {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(teamId: TeamId): Promise<readonly TeamMembership[]> {
    const team = await this.deps.office.findTeamById(teamId);
    if (team === null) {
      throw new TeamNotFoundError(teamId);
    }

    return this.deps.office.listTeamMembershipsByTeam(teamId);
  }
}

export class CreateGoal {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(command: CreateGoalCommand): Promise<Goal> {
    await assertWorkspaceExists(this.deps.workspaces, command.workspaceId);

    const goal = Goal.create({
      id: this.deps.ids.createId() as GoalId,
      workspaceId: command.workspaceId,
      key: command.key,
      title: command.title,
      description: command.description,
      now: this.deps.clock.now(),
    });

    await this.deps.office.saveGoal(goal);
    return goal;
  }
}

export class GetGoal {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(goalId: GoalId): Promise<Goal> {
    const goal = await this.deps.office.findGoalById(goalId);
    if (goal === null) {
      throw new GoalNotFoundError(goalId);
    }

    return goal;
  }
}

export class ListGoals {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(workspaceId: WorkspaceId): Promise<readonly Goal[]> {
    await assertWorkspaceExists(this.deps.workspaces, workspaceId);
    return this.deps.office.listGoalsByWorkspace(workspaceId);
  }
}

export class UpdateGoal {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(command: UpdateGoalCommand): Promise<Goal> {
    const existing = await this.deps.office.findGoalById(command.goalId);
    if (existing === null) {
      throw new GoalNotFoundError(command.goalId);
    }

    const updated = existing.update({
      title: command.title,
      description: command.description,
      status: command.status,
      now: this.deps.clock.now(),
    });
    const persisted = await this.deps.office.updateGoal(updated);
    if (persisted === null) {
      throw new GoalNotFoundError(command.goalId);
    }

    return persisted;
  }
}

export class CreateAssignment {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(command: CreateAssignmentCommand): Promise<Assignment> {
    await assertWorkspaceExists(this.deps.workspaces, command.workspaceId);

    const officeWorker = await this.deps.office.findOfficeWorkerById(
      command.officeWorkerId,
    );
    if (officeWorker === null) {
      throw new OfficeWorkerNotFoundError(command.officeWorkerId);
    }

    if (officeWorker.workspaceId !== command.workspaceId) {
      throw new DomainInvariantError(
        `OfficeWorker ${officeWorker.id} belongs to workspace ${officeWorker.workspaceId}, not ${command.workspaceId}.`,
      );
    }

    if (command.goalId !== undefined) {
      const goal = await this.deps.office.findGoalById(command.goalId);
      if (goal === null) {
        throw new GoalNotFoundError(command.goalId);
      }

      if (goal.workspaceId !== command.workspaceId) {
        throw new DomainInvariantError(
          `Goal ${goal.id} belongs to workspace ${goal.workspaceId}, not ${command.workspaceId}.`,
        );
      }
    }

    await assertAssignmentTarget(this.deps, {
      workspaceId: command.workspaceId,
      officeWorker,
      targetType: command.targetType,
      targetVersionId: command.targetVersionId,
    });

    const assignment = Assignment.create({
      id: this.deps.ids.createId() as AssignmentId,
      workspaceId: command.workspaceId,
      goalId: command.goalId,
      officeWorkerId: command.officeWorkerId,
      title: command.title,
      description: command.description,
      targetType: command.targetType,
      targetVersionId: command.targetVersionId,
      input: command.input,
      now: this.deps.clock.now(),
    });

    await this.deps.office.saveAssignment(assignment);
    return assignment;
  }
}

export class GetAssignment {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(assignmentId: AssignmentId): Promise<Assignment> {
    const assignment = await this.deps.office.findAssignmentById(assignmentId);
    if (assignment === null) {
      throw new AssignmentNotFoundError(assignmentId);
    }

    return assignment;
  }
}

export class ListAssignments {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(workspaceId: WorkspaceId): Promise<readonly Assignment[]> {
    await assertWorkspaceExists(this.deps.workspaces, workspaceId);
    return this.deps.office.listAssignmentsByWorkspace(workspaceId);
  }
}

export class CancelAssignment {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(assignmentId: AssignmentId): Promise<Assignment> {
    const existing = await this.deps.office.findAssignmentById(assignmentId);
    if (existing === null) {
      throw new AssignmentNotFoundError(assignmentId);
    }

    if (existing.status !== "PENDING") {
      throw new DomainInvariantError(
        `Assignment ${assignmentId} cannot be cancelled from status ${existing.status}.`,
      );
    }

    const cancelled = existing.cancel(this.deps.clock.now());
    return this.deps.office.transitionAssignment(existing.status, cancelled);
  }
}

export class UpdateAssignment {
  constructor(private readonly deps: OfficeApplicationDependencies) {}

  async execute(command: UpdateAssignmentCommand): Promise<Assignment> {
    const existing = await this.deps.office.findAssignmentById(
      command.assignmentId,
    );
    if (existing === null) {
      throw new AssignmentNotFoundError(command.assignmentId);
    }

    if (command.goalId !== undefined && command.goalId !== null) {
      const goal = await this.deps.office.findGoalById(command.goalId);
      if (goal === null) {
        throw new GoalNotFoundError(command.goalId);
      }

      if (goal.workspaceId !== existing.workspaceId) {
        throw new DomainInvariantError(
          `Goal ${goal.id} belongs to workspace ${goal.workspaceId}, not ${existing.workspaceId}.`,
        );
      }
    }

    const updated = existing.update({
      title: command.title,
      description: command.description,
      goalId: command.goalId,
      now: this.deps.clock.now(),
    });
    const persisted = await this.deps.office.updateAssignment(updated);
    if (persisted === null) {
      throw new AssignmentNotFoundError(command.assignmentId);
    }

    return persisted;
  }
}

export interface OfficeApplication {
  readonly createOfficeWorker: CreateOfficeWorker;
  readonly getOfficeWorker: GetOfficeWorker;
  readonly listOfficeWorkers: ListOfficeWorkers;
  readonly updateOfficeWorker: UpdateOfficeWorker;
  readonly createRole: CreateRole;
  readonly getRole: GetRole;
  readonly listRoles: ListRoles;
  readonly updateRole: UpdateRole;
  readonly createTeam: CreateTeam;
  readonly getTeam: GetTeam;
  readonly listTeams: ListTeams;
  readonly updateTeam: UpdateTeam;
  readonly addTeamMembership: AddTeamMembership;
  readonly listTeamMemberships: ListTeamMemberships;
  readonly createGoal: CreateGoal;
  readonly getGoal: GetGoal;
  readonly listGoals: ListGoals;
  readonly updateGoal: UpdateGoal;
  readonly createAssignment: CreateAssignment;
  readonly getAssignment: GetAssignment;
  readonly listAssignments: ListAssignments;
  readonly updateAssignment: UpdateAssignment;
  readonly cancelAssignment: CancelAssignment;
}

export function createOfficeApplication(
  deps: OfficeApplicationDependencies,
): OfficeApplication {
  return {
    createOfficeWorker: new CreateOfficeWorker(deps),
    getOfficeWorker: new GetOfficeWorker(deps),
    listOfficeWorkers: new ListOfficeWorkers(deps),
    updateOfficeWorker: new UpdateOfficeWorker(deps),
    createRole: new CreateRole(deps),
    getRole: new GetRole(deps),
    listRoles: new ListRoles(deps),
    updateRole: new UpdateRole(deps),
    createTeam: new CreateTeam(deps),
    getTeam: new GetTeam(deps),
    listTeams: new ListTeams(deps),
    updateTeam: new UpdateTeam(deps),
    addTeamMembership: new AddTeamMembership(deps),
    listTeamMemberships: new ListTeamMemberships(deps),
    createGoal: new CreateGoal(deps),
    getGoal: new GetGoal(deps),
    listGoals: new ListGoals(deps),
    updateGoal: new UpdateGoal(deps),
    createAssignment: new CreateAssignment(deps),
    getAssignment: new GetAssignment(deps),
    listAssignments: new ListAssignments(deps),
    updateAssignment: new UpdateAssignment(deps),
    cancelAssignment: new CancelAssignment(deps),
  };
}

async function assertWorkspaceExists(
  workspaces: WorkspaceRepository,
  workspaceId: WorkspaceId,
): Promise<void> {
  const workspace = await workspaces.findById(workspaceId);
  if (workspace === null) {
    throw new WorkspaceNotFoundError(workspaceId);
  }
}

async function assertAgentInWorkspace(
  agents: AgentRepository,
  workspaceId: WorkspaceId,
  agentId: AgentId,
): Promise<void> {
  const agent = await agents.findAgentById(agentId);
  if (agent === null) {
    throw new AgentNotFoundError(agentId);
  }

  if (agent.workspaceId !== workspaceId) {
    throw new DomainInvariantError(
      `Agent ${agent.id} belongs to workspace ${agent.workspaceId}, not ${workspaceId}.`,
    );
  }
}

async function assertAssignmentTarget(
  deps: OfficeApplicationDependencies,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly officeWorker: OfficeWorker;
    readonly targetType: AssignmentTargetType;
    readonly targetVersionId: string;
  },
): Promise<void> {
  if (input.targetType === "AGENT_VERSION") {
    const agentVersion = await deps.agents.findAgentVersionById(
      input.targetVersionId as AgentVersionId,
    );
    if (agentVersion === null) {
      throw new AgentVersionNotFoundError(
        input.targetVersionId as AgentVersionId,
      );
    }

    if (agentVersion.agentId !== input.officeWorker.agentId) {
      throw new DomainInvariantError(
        `AgentVersion ${agentVersion.id} belongs to Agent ${agentVersion.agentId}, not OfficeWorker agent ${input.officeWorker.agentId}.`,
      );
    }

    const agent = await deps.agents.findAgentById(agentVersion.agentId);
    if (agent === null || agent.workspaceId !== input.workspaceId) {
      throw new DomainInvariantError(
        `AgentVersion ${agentVersion.id} does not belong to workspace ${input.workspaceId}.`,
      );
    }

    return;
  }

  const workflowVersion = await deps.workflows.findWorkflowVersionById(
    input.targetVersionId as WorkflowVersionId,
  );
  if (
    workflowVersion === null ||
    workflowVersion.workspaceId !== input.workspaceId
  ) {
    throw new WorkflowVersionNotFoundError(
      input.targetVersionId as WorkflowVersionId,
    );
  }
}
