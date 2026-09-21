import type {
  AgentId,
  AgentVersionId,
  AssignmentId,
  AssignmentState,
  GoalId,
  OfficeWorkerId,
  RoleId,
  TeamId,
  WorkspaceId,
} from "@osva/contracts";
import { describe, expect, it } from "vitest";

import {
  Agent,
  AgentVersion,
  Assignment,
  DomainInvariantError,
  GoalNotFoundError,
  OfficeWorkerNotFoundError,
  Goal,
  OfficeWorker,
  Workspace,
  createOfficeApplication,
  type AgentRepository,
  type Assignment as AssignmentEntity,
  type Goal as GoalEntity,
  type OfficeRepository,
  type OfficeWorker as OfficeWorkerEntity,
  type Role as RoleEntity,
  type Team as TeamEntity,
  type TeamMembership as TeamMembershipEntity,
  type WorkflowRepository,
  type WorkspaceRepository,
} from "../src/index.js";
import { fakeControlPlaneScope } from "./control-plane-test-scope.js";
import {
  NOW,
  agentId,
  agentVersionId,
  createManifest,
  workspaceId,
} from "./fixtures.js";

const scope = fakeControlPlaneScope(workspaceId);

const otherWorkspaceId = "ws-2" as WorkspaceId;
const officeWorkerId = "office-worker-1" as OfficeWorkerId;
const goalId = "goal-1" as GoalId;

class TestWorkspaceRepository implements WorkspaceRepository {
  private readonly items = new Map<WorkspaceId, Workspace>();

  async save(workspace: Workspace): Promise<void> {
    this.items.set(workspace.id, workspace);
  }

  async findById(id: WorkspaceId): Promise<Workspace | null> {
    return this.items.get(id) ?? null;
  }

  async countAll(): Promise<number> {
    return this.items.size;
  }

  async listIds(): Promise<readonly WorkspaceId[]> {
    return [...this.items.keys()].sort();
  }
}

class TestAgentRepository implements AgentRepository {
  private readonly agents = new Map<AgentId, Agent>();
  private readonly versions = new Map<AgentVersionId, AgentVersion>();

  async saveAgent(agent: Agent): Promise<void> {
    this.agents.set(agent.id, agent);
  }

  async findAgentById(id: AgentId): Promise<Agent | null> {
    return this.agents.get(id) ?? null;
  }

  async findAgentByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: AgentId,
  ): Promise<Agent | null> {
    const agent = this.agents.get(id);
    return agent?.workspaceId === workspaceId ? agent : null;
  }

  async listAgentsByWorkspaceId(workspaceId: WorkspaceId): Promise<Agent[]> {
    return [...this.agents.values()].filter(
      (agent) => agent.workspaceId === workspaceId,
    );
  }

  async listAgents(): Promise<Agent[]> {
    return [...this.agents.values()];
  }

  async updateAgentMetadata(): Promise<Agent | null> {
    return null;
  }

  async saveAgentVersion(version: AgentVersion): Promise<void> {
    this.versions.set(version.id, version);
  }

  async appendAgentVersion(): Promise<AgentVersion> {
    throw new Error("not implemented");
  }

  async findAgentVersionById(id: AgentVersionId): Promise<AgentVersion | null> {
    return this.versions.get(id) ?? null;
  }

  async listAgentVersions(agentIdValue: AgentId): Promise<AgentVersion[]> {
    return [...this.versions.values()].filter(
      (version) => version.agentId === agentIdValue,
    );
  }
}

class TestOfficeRepository implements OfficeRepository {
  private readonly officeWorkers = new Map<
    OfficeWorkerId,
    OfficeWorkerEntity
  >();
  private readonly roles = new Map<RoleId, RoleEntity>();
  private readonly teams = new Map<TeamId, TeamEntity>();
  private readonly memberships = new Map<string, TeamMembershipEntity>();
  private readonly goals = new Map<GoalId, GoalEntity>();
  private readonly assignments = new Map<string, AssignmentEntity>();

  async saveOfficeWorker(officeWorker: OfficeWorkerEntity): Promise<void> {
    this.officeWorkers.set(officeWorker.id, officeWorker);
  }

  async findOfficeWorkerById(
    id: OfficeWorkerId,
  ): Promise<OfficeWorkerEntity | null> {
    return this.officeWorkers.get(id) ?? null;
  }

  async findOfficeWorkerByWorkspaceAndId(
    workspaceIdValue: WorkspaceId,
    id: OfficeWorkerId,
  ): Promise<OfficeWorkerEntity | null> {
    const worker = this.officeWorkers.get(id);
    return worker?.workspaceId === workspaceIdValue ? worker : null;
  }

  async listOfficeWorkersByWorkspace(
    workspaceIdValue: WorkspaceId,
  ): Promise<readonly OfficeWorkerEntity[]> {
    return [...this.officeWorkers.values()].filter(
      (worker) => worker.workspaceId === workspaceIdValue,
    );
  }

  async updateOfficeWorker(
    officeWorker: OfficeWorkerEntity,
  ): Promise<OfficeWorkerEntity | null> {
    this.officeWorkers.set(officeWorker.id, officeWorker);
    return officeWorker;
  }

  async saveRole(role: RoleEntity): Promise<void> {
    this.roles.set(role.id, role);
  }

  async findRoleById(id: RoleId): Promise<RoleEntity | null> {
    return this.roles.get(id) ?? null;
  }

  async findRoleByWorkspaceAndId(
    workspaceIdValue: WorkspaceId,
    id: RoleId,
  ): Promise<RoleEntity | null> {
    const role = this.roles.get(id);
    return role?.workspaceId === workspaceIdValue ? role : null;
  }

  async listRolesByWorkspace(
    workspaceIdValue: WorkspaceId,
  ): Promise<readonly RoleEntity[]> {
    return [...this.roles.values()].filter(
      (role) => role.workspaceId === workspaceIdValue,
    );
  }

  async updateRole(role: RoleEntity): Promise<RoleEntity | null> {
    this.roles.set(role.id, role);
    return role;
  }

  async saveTeam(team: TeamEntity): Promise<void> {
    this.teams.set(team.id, team);
  }

  async findTeamById(id: TeamId): Promise<TeamEntity | null> {
    return this.teams.get(id) ?? null;
  }

  async findTeamByWorkspaceAndId(
    workspaceIdValue: WorkspaceId,
    id: TeamId,
  ): Promise<TeamEntity | null> {
    const team = this.teams.get(id);
    return team?.workspaceId === workspaceIdValue ? team : null;
  }

  async listTeamsByWorkspace(
    workspaceIdValue: WorkspaceId,
  ): Promise<readonly TeamEntity[]> {
    return [...this.teams.values()].filter(
      (team) => team.workspaceId === workspaceIdValue,
    );
  }

  async updateTeam(team: TeamEntity): Promise<TeamEntity | null> {
    this.teams.set(team.id, team);
    return team;
  }

  async addTeamMembership(membership: TeamMembershipEntity): Promise<void> {
    this.memberships.set(
      `${membership.teamId}:${membership.officeWorkerId}`,
      membership,
    );
  }

  async findTeamMembership(
    teamId: TeamId,
    officeWorkerIdValue: OfficeWorkerId,
  ): Promise<TeamMembershipEntity | null> {
    return this.memberships.get(`${teamId}:${officeWorkerIdValue}`) ?? null;
  }

  async listTeamMembershipsByTeam(
    teamId: TeamId,
  ): Promise<readonly TeamMembershipEntity[]> {
    return [...this.memberships.values()].filter(
      (membership) => membership.teamId === teamId,
    );
  }

  async saveGoal(goal: GoalEntity): Promise<void> {
    this.goals.set(goal.id, goal);
  }

  async findGoalById(id: GoalId): Promise<GoalEntity | null> {
    return this.goals.get(id) ?? null;
  }

  async findGoalByWorkspaceAndId(
    workspaceIdValue: WorkspaceId,
    id: GoalId,
  ): Promise<GoalEntity | null> {
    const goal = this.goals.get(id);
    return goal?.workspaceId === workspaceIdValue ? goal : null;
  }

  async listGoalsByWorkspace(
    workspaceIdValue: WorkspaceId,
  ): Promise<readonly GoalEntity[]> {
    return [...this.goals.values()].filter(
      (goal) => goal.workspaceId === workspaceIdValue,
    );
  }

  async updateGoal(goal: GoalEntity): Promise<GoalEntity | null> {
    this.goals.set(goal.id, goal);
    return goal;
  }

  async saveAssignment(assignment: AssignmentEntity): Promise<void> {
    this.assignments.set(assignment.id, assignment);
  }

  async findAssignmentById(id: string): Promise<AssignmentEntity | null> {
    return this.assignments.get(id) ?? null;
  }

  async findAssignmentByWorkspaceAndId(
    workspaceIdValue: WorkspaceId,
    id: AssignmentId,
  ): Promise<AssignmentEntity | null> {
    const assignment = this.assignments.get(id);
    return assignment?.workspaceId === workspaceIdValue ? assignment : null;
  }

  async listAssignmentsByWorkspace(
    workspaceIdValue: WorkspaceId,
  ): Promise<readonly AssignmentEntity[]> {
    return [...this.assignments.values()].filter(
      (assignment) => assignment.workspaceId === workspaceIdValue,
    );
  }

  async updateAssignment(
    assignment: AssignmentEntity,
  ): Promise<AssignmentEntity | null> {
    this.assignments.set(assignment.id, assignment);
    return assignment;
  }

  async transitionAssignment(
    expectedStatus: AssignmentState,
    next: AssignmentEntity,
  ): Promise<AssignmentEntity> {
    const existing = this.assignments.get(next.id);
    if (existing === undefined || existing.status !== expectedStatus) {
      throw new Error("transition conflict");
    }

    this.assignments.set(next.id, next);
    return next;
  }
}

const emptyWorkflowRepository: WorkflowRepository = {
  saveWorkflow: async () => {},
  findWorkflowById: async () => null,
  findWorkflowByWorkspaceAndId: async () => null,
  listWorkflows: async () => [],
  listWorkflowsByWorkspaceId: async () => [],
  saveWorkflowVersion: async () => {},
  appendWorkflowVersion: async () => {
    throw new Error("not implemented");
  },
  findWorkflowVersionById: async () => null,
  listWorkflowVersions: async () => [],
};

async function createOfficeApp() {
  const workspaces = new TestWorkspaceRepository();
  const agents = new TestAgentRepository();
  const office = new TestOfficeRepository();
  const clock = { now: () => NOW };
  let counter = 0;
  const ids = {
    createId() {
      counter += 1;
      return `generated-${String(counter)}`;
    },
  };

  await workspaces.save(
    Workspace.create({ id: workspaceId, name: "Workspace", createdAt: NOW }),
  );
  await workspaces.save(
    Workspace.create({
      id: otherWorkspaceId,
      name: "Other",
      createdAt: NOW,
    }),
  );

  await agents.saveAgent(
    Agent.create({
      id: agentId,
      workspaceId,
      key: "agent",
      name: "Agent",
      createdAt: NOW,
    }),
  );
  await agents.saveAgentVersion(
    AgentVersion.create({
      id: agentVersionId,
      agentId,
      version: 1,
      manifest: createManifest(),
      createdAt: NOW,
    }),
  );

  return {
    office: createOfficeApplication({
      office,
      workspaces,
      agents,
      workflows: emptyWorkflowRepository,
      clock,
      ids,
    }),
    officeRepository: office,
  };
}

describe("Office application", () => {
  it("creates and updates office workers", async () => {
    const { office } = await createOfficeApp();

    const worker = await office.createOfficeWorker.execute(scope, {
      workspaceId,
      key: "analyst",
      name: "Analyst",
      agentId,
    });

    expect(worker.agentId).toBe(agentId);

    const updated = await office.updateOfficeWorker.execute(scope, {
      officeWorkerId: worker.id,
      name: "Senior Analyst",
    });
    expect(updated.name).toBe("Senior Analyst");
  });

  it("creates roles as organizational metadata only", async () => {
    const { office } = await createOfficeApp();

    const role = await office.createRole.execute(scope, {
      workspaceId,
      key: "reviewer",
      name: "Reviewer",
    });

    expect(role.key).toBe("reviewer");
  });

  it("adds team memberships within a workspace", async () => {
    const { office } = await createOfficeApp();

    const worker = await office.createOfficeWorker.execute(scope, {
      workspaceId,
      key: "worker",
      name: "Worker",
      agentId,
    });
    const team = await office.createTeam.execute(scope, {
      workspaceId,
      key: "ops",
      name: "Ops",
    });
    const role = await office.createRole.execute(scope, {
      workspaceId,
      key: "lead",
      name: "Lead",
    });

    const membership = await office.addTeamMembership.execute(scope, {
      teamId: team.id,
      officeWorkerId: worker.id,
      roleId: role.id,
    });

    expect(membership.roleId).toBe(role.id);
  });

  it("rejects cross-workspace team membership", async () => {
    const { office, officeRepository } = await createOfficeApp();

    const otherWorker = OfficeWorker.create({
      id: officeWorkerId,
      workspaceId: otherWorkspaceId,
      key: "other",
      name: "Other",
      agentId,
      now: NOW,
    });
    await officeRepository.saveOfficeWorker(otherWorker);

    const team = await office.createTeam.execute(scope, {
      workspaceId,
      key: "ops",
      name: "Ops",
    });

    await expect(
      office.addTeamMembership.execute(scope, {
        teamId: team.id,
        officeWorkerId: otherWorker.id,
      }),
    ).rejects.toBeInstanceOf(OfficeWorkerNotFoundError);
  });

  it("freezes assignment target version at creation", async () => {
    const { office } = await createOfficeApp();

    const worker = await office.createOfficeWorker.execute(scope, {
      workspaceId,
      key: "worker",
      name: "Worker",
      agentId,
    });

    const assignment = await office.createAssignment.execute(scope, {
      workspaceId,
      officeWorkerId: worker.id,
      title: "Analyze",
      targetType: "AGENT_VERSION",
      targetVersionId: agentVersionId,
      input: { prompt: "hello" },
    });

    expect(assignment.targetVersionId).toBe(agentVersionId);
  });

  it("rejects cross-workspace assignment relationships", async () => {
    const { office, officeRepository } = await createOfficeApp();

    const worker = await office.createOfficeWorker.execute(scope, {
      workspaceId,
      key: "worker",
      name: "Worker",
      agentId,
    });

    const foreignGoal = Goal.create({
      id: goalId,
      workspaceId: otherWorkspaceId,
      key: "foreign",
      title: "Foreign",
      now: NOW,
    });
    await officeRepository.saveGoal(foreignGoal);

    await expect(
      office.createAssignment.execute(scope, {
        workspaceId,
        goalId: foreignGoal.id,
        officeWorkerId: worker.id,
        title: "Task",
        targetType: "AGENT_VERSION",
        targetVersionId: agentVersionId,
        input: {},
      }),
    ).rejects.toBeInstanceOf(GoalNotFoundError);
  });

  it("blocks assignment metadata updates after launch", async () => {
    const { office, officeRepository } = await createOfficeApp();

    const worker = await office.createOfficeWorker.execute(scope, {
      workspaceId,
      key: "worker",
      name: "Worker",
      agentId,
    });

    const assignment = await office.createAssignment.execute(scope, {
      workspaceId,
      officeWorkerId: worker.id,
      title: "Task",
      targetType: "AGENT_VERSION",
      targetVersionId: agentVersionId,
      input: {},
    });

    const launched = assignment.markLaunched({
      runId: "run-1" as Assignment["runId"],
      now: NOW,
    });
    await officeRepository.updateAssignment(launched);

    await expect(
      office.updateAssignment.execute(scope, {
        assignmentId: launched.id,
        title: "Changed",
      }),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });
});
