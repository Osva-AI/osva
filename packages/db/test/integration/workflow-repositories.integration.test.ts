import type {
  AgentVersionId,
  WorkflowId,
  WorkflowVersionId,
} from "@osva/contracts";
import {
  Agent,
  AgentVersion,
  DomainInvariantError,
  DuplicateWorkflowKeyError,
  Workflow,
  WorkflowRun,
  WorkflowVersion,
  Workspace,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresAgentRepository } from "../../src/repositories/postgres-agent-repository.js";
import { PostgresWorkflowRepository } from "../../src/repositories/postgres-workflow-repository.js";
import { PostgresWorkflowRunRepository } from "../../src/repositories/postgres-workflow-run-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { createIds, createManifest, NOW } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

describe("PostgreSQL workflow repositories", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let agents: PostgresAgentRepository;
  let workflows: PostgresWorkflowRepository;
  let workflowRuns: PostgresWorkflowRunRepository;

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
    workflows = new PostgresWorkflowRepository(database);
    workflowRuns = new PostgresWorkflowRunRepository(database);
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

  it("persists Workflow and immutable WorkflowVersion with unique version numbers", async () => {
    const ids = createIds("workflow");
    await workspaces.save(
      Workspace.create({
        id: ids.workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );
    const workflow = Workflow.create({
      id: "workflow-1" as WorkflowId,
      workspaceId: ids.workspaceId,
      key: "research-report",
      name: "Research Report",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await workflows.saveWorkflow(workflow);

    const definition = {
      schemaVersion: "1" as const,
      nodes: [
        {
          key: "research",
          type: "AGENT" as const,
          agentVersionId: ids.agentVersionId,
        },
      ],
      edges: [],
    };
    const first = await workflows.appendWorkflowVersion({
      id: "workflow-version-1" as WorkflowVersionId,
      workflowId: workflow.id,
      definition,
      createdAt: NOW,
    });
    const second = await workflows.appendWorkflowVersion({
      id: "workflow-version-2" as WorkflowVersionId,
      workflowId: workflow.id,
      definition,
      createdAt: NOW,
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);

    await expect(
      workflows.saveWorkflowVersion(
        WorkflowVersion.create({
          id: first.id,
          workflowId: workflow.id,
          workspaceId: ids.workspaceId,
          version: 9,
          definition,
          createdAt: NOW,
        }),
      ),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });

  it("rejects duplicate workflow keys in a workspace", async () => {
    const ids = createIds("dup");
    await workspaces.save(
      Workspace.create({
        id: ids.workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );
    await workflows.saveWorkflow(
      Workflow.create({
        id: "workflow-1" as WorkflowId,
        workspaceId: ids.workspaceId,
        key: "research-report",
        name: "Research Report",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );

    await expect(
      workflows.saveWorkflow(
        Workflow.create({
          id: "workflow-2" as WorkflowId,
          workspaceId: ids.workspaceId,
          key: "research-report",
          name: "Other",
          createdAt: NOW,
          updatedAt: NOW,
        }),
      ),
    ).rejects.toBeInstanceOf(DuplicateWorkflowKeyError);
  });

  it("persists a WorkflowRun and lists it as active until terminal", async () => {
    const ids = createIds("run");
    await workspaces.save(
      Workspace.create({
        id: ids.workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );
    await agents.saveAgent(
      Agent.create({
        id: ids.agentId,
        workspaceId: ids.workspaceId,
        key: "example-agent",
        name: "Example Agent",
        createdAt: NOW,
      }),
    );
    await agents.saveAgentVersion(
      AgentVersion.create({
        id: ids.agentVersionId,
        agentId: ids.agentId,
        version: 1,
        manifest: createManifest(),
        createdAt: NOW,
      }),
    );
    const workflow = Workflow.create({
      id: "workflow-1" as WorkflowId,
      workspaceId: ids.workspaceId,
      key: "research-report",
      name: "Research Report",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await workflows.saveWorkflow(workflow);
    const version = await workflows.appendWorkflowVersion({
      id: "workflow-version-1" as WorkflowVersionId,
      workflowId: workflow.id,
      definition: {
        schemaVersion: "1",
        nodes: [
          {
            key: "research",
            type: "AGENT",
            agentVersionId: ids.agentVersionId as AgentVersionId,
          },
        ],
        edges: [],
      },
      createdAt: NOW,
    });
    const workflowRun = WorkflowRun.create({
      id: "workflow-run-1" as never,
      workspaceId: ids.workspaceId,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      input: { topic: "osva" },
      createdAt: NOW,
    });
    await workflowRuns.saveWorkflowRun(workflowRun);

    const active = await workflowRuns.listActiveWorkflowRuns(10);
    expect(active.map((run) => run.id)).toEqual([workflowRun.id]);
  });
});
