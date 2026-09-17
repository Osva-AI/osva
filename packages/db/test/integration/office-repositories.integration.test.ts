import type {
  AgentId,
  AgentVersionId,
  AssignmentId,
  GoalId,
  OfficeWorkerId,
  RoleId,
  TeamId,
  WorkspaceId,
} from "@osva/contracts";
import {
  Agent,
  AgentVersion,
  Assignment,
  Goal,
  OfficeWorker,
  Role,
  Team,
  TeamMembership,
  Workspace,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresAgentRepository } from "../../src/repositories/postgres-agent-repository.js";
import { PostgresOfficeRepository } from "../../src/repositories/postgres-office-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { NOW, createManifest } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

describe("PostgreSQL office repository", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let agents: PostgresAgentRepository;
  let office: PostgresOfficeRepository;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    workspaces = new PostgresWorkspaceRepository(database);
    agents = new PostgresAgentRepository(database);
    office = new PostgresOfficeRepository(database);
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
    if (context) {
      await stopPostgresForTests(context);
    }
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
  });

  it("persists office entities with workspace isolation", async () => {
    const workspaceA = "ws-a" as WorkspaceId;
    const workspaceB = "ws-b" as WorkspaceId;
    await workspaces.save(
      Workspace.create({ id: workspaceA, name: "A", createdAt: NOW }),
    );
    await workspaces.save(
      Workspace.create({ id: workspaceB, name: "B", createdAt: NOW }),
    );

    const agentA = "agent-a" as AgentId;
    const agentVersionA = "agent-version-a" as AgentVersionId;
    await agents.saveAgent(
      Agent.create({
        id: agentA,
        workspaceId: workspaceA,
        key: "agent",
        name: "Agent",
        createdAt: NOW,
      }),
    );
    await agents.saveAgentVersion(
      AgentVersion.create({
        id: agentVersionA,
        agentId: agentA,
        version: 1,
        manifest: createManifest(),
        createdAt: NOW,
      }),
    );

    const workerA = OfficeWorker.create({
      id: "office-worker-a" as OfficeWorkerId,
      workspaceId: workspaceA,
      key: "worker",
      name: "Worker A",
      agentId: agentA,
      now: NOW,
    });
    await office.saveOfficeWorker(workerA);

    const role = Role.create({
      id: "role-a" as RoleId,
      workspaceId: workspaceA,
      key: "reviewer",
      name: "Reviewer",
      now: NOW,
    });
    await office.saveRole(role);

    const team = Team.create({
      id: "team-a" as TeamId,
      workspaceId: workspaceA,
      key: "ops",
      name: "Ops",
      now: NOW,
    });
    await office.saveTeam(team);

    await office.addTeamMembership(
      TeamMembership.create({
        teamId: team.id,
        officeWorkerId: workerA.id,
        roleId: role.id,
      }),
    );

    const goal = Goal.create({
      id: "goal-a" as GoalId,
      workspaceId: workspaceA,
      key: "goal",
      title: "Ship",
      now: NOW,
    });
    await office.saveGoal(goal);

    const assignment = Assignment.create({
      id: "assignment-a" as AssignmentId,
      workspaceId: workspaceA,
      goalId: goal.id,
      officeWorkerId: workerA.id,
      title: "Run analysis",
      targetType: "AGENT_VERSION",
      targetVersionId: agentVersionA,
      input: { prompt: "hello" },
      now: NOW,
    });
    await office.saveAssignment(assignment);

    expect(await office.listOfficeWorkersByWorkspace(workspaceA)).toHaveLength(
      1,
    );
    expect(await office.listOfficeWorkersByWorkspace(workspaceB)).toHaveLength(
      0,
    );
    expect(await office.findAssignmentById(assignment.id)).toMatchObject({
      targetVersionId: agentVersionA,
      status: "PENDING",
    });
  });
});
