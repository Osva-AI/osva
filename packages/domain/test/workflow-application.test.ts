import type {
  AgentId,
  AgentVersionId,
  WorkflowDefinitionV1,
  WorkflowId,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { Agent } from "../src/agent.js";
import { AgentVersion } from "../src/agent-version.js";
import {
  AgentVersionNotFoundError,
  DomainInvariantError,
  WorkspaceNotFoundError,
} from "../src/errors.js";
import type { AgentRepository } from "../src/ports/agent-repository.js";
import type { WorkflowRepository } from "../src/ports/workflow-repository.js";
import type { WorkflowRunRepository } from "../src/ports/workflow-run-repository.js";
import type { WorkspaceRepository } from "../src/ports/workspace-repository.js";
import { Workflow } from "../src/workflow.js";
import { createWorkflowApplication } from "../src/workflow-application.js";
import { WorkflowVersion } from "../src/workflow-version.js";
import { Workspace } from "../src/workspace.js";
import { createManifest, NOW } from "./fixtures.js";

const workspaceId = "ws-1" as WorkspaceId;
const otherWorkspaceId = "ws-2" as WorkspaceId;
const agentId = "agent-1" as AgentId;
const agentVersionId = "agent-version-1" as AgentVersionId;

function sequentialDefinition(
  versionId: AgentVersionId = agentVersionId,
): WorkflowDefinitionV1 {
  return {
    schemaVersion: "1",
    nodes: [{ key: "research", type: "AGENT", agentVersionId: versionId }],
    edges: [],
  };
}

describe("workflow application", () => {
  it("creates a Workflow and an immutable WorkflowVersion", async () => {
    const app = await createApp();

    const workflow = await app.createWorkflow.execute({
      workspaceId,
      key: "research-report",
      name: "Research Report",
    });
    const version = await app.appendWorkflowVersion.execute({
      workflowId: workflow.id,
      definition: sequentialDefinition(),
    });

    expect(version.workflowId).toBe(workflow.id);
    expect(version.version).toBe(1);
    expect(version.definition.nodes[0]?.type).toBe("AGENT");
    expect(
      version.definition.nodes[0]?.type === "AGENT"
        ? version.definition.nodes[0].agentVersionId
        : undefined,
    ).toBe(agentVersionId);

    const run = await app.createWorkflowRun.execute({
      workspaceId,
      workflowVersionId: version.id,
      input: { topic: "osva" },
    });
    expect(run.status).toBe("PENDING");
    expect(run.workflowVersionId).toBe(version.id);
    expect(run.input).toEqual({ topic: "osva" });
  });

  it("accepts a V2 DAG WorkflowVersion", async () => {
    const app = await createApp();
    const workflow = await app.createWorkflow.execute({
      workspaceId,
      key: "parallel-report",
      name: "Parallel Report",
    });
    const version = await app.appendWorkflowVersion.execute({
      workflowId: workflow.id,
      definition: {
        schemaVersion: "2",
        nodes: [
          { key: "a", type: "AGENT", agentVersionId },
          { key: "fanout", type: "PARALLEL" },
          { key: "b", type: "AGENT", agentVersionId },
          { key: "c", type: "AGENT", agentVersionId },
          { key: "join", type: "JOIN" },
        ],
        edges: [
          { from: "a", to: "fanout" },
          { from: "fanout", to: "b" },
          { from: "fanout", to: "c" },
          { from: "b", to: "join" },
          { from: "c", to: "join" },
        ],
      },
    });
    expect(version.definition.schemaVersion).toBe("2");
  });

  it("rejects unknown AgentVersion bindings", async () => {
    const app = await createApp();
    const workflow = await app.createWorkflow.execute({
      workspaceId,
      key: "research-report",
      name: "Research Report",
    });

    await expect(
      app.appendWorkflowVersion.execute({
        workflowId: workflow.id,
        definition: sequentialDefinition(
          "missing-agent-version" as AgentVersionId,
        ),
      }),
    ).rejects.toBeInstanceOf(AgentVersionNotFoundError);
  });

  it("rejects AgentVersions from another workspace", async () => {
    const workspaces = new InMemoryWorkspaceRepository();
    const agents = new InMemoryAgentRepository();
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
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
        workspaceId: otherWorkspaceId,
        key: "foreign-agent",
        name: "Foreign Agent",
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

    const app = createWorkflowApplication({
      workflows: new InMemoryWorkflowRepository(),
      workflowRuns: new InMemoryWorkflowRunRepository(),
      agents,
      workspaces,
      clock: { now: () => NOW },
      ids: {
        createId() {
          return "id-1";
        },
      },
    });

    const workflow = await app.createWorkflow.execute({
      workspaceId,
      key: "research-report",
      name: "Research Report",
    });

    await expect(
      app.appendWorkflowVersion.execute({
        workflowId: workflow.id,
        definition: sequentialDefinition(),
      }),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });

  it("rejects Workflow creation for an unknown workspace", async () => {
    const app = await createApp({ seedWorkspace: false });
    await expect(
      app.createWorkflow.execute({
        workspaceId,
        key: "research-report",
        name: "Research Report",
      }),
    ).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });
});

async function createApp(options?: { readonly seedWorkspace?: boolean }) {
  const workspaces = new InMemoryWorkspaceRepository();
  const agents = new InMemoryAgentRepository();
  if (options?.seedWorkspace !== false) {
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );
    await agents.saveAgent(
      Agent.create({
        id: agentId,
        workspaceId,
        key: "example-agent",
        name: "Example Agent",
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
  }

  let counter = 0;
  return createWorkflowApplication({
    workflows: new InMemoryWorkflowRepository(),
    workflowRuns: new InMemoryWorkflowRunRepository(),
    agents,
    workspaces,
    clock: { now: () => NOW },
    ids: {
      createId() {
        counter += 1;
        return `id-${String(counter)}`;
      },
    },
  });
}

class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private readonly workspaces = new Map<WorkspaceId, Workspace>();

  async save(workspace: Workspace): Promise<void> {
    this.workspaces.set(workspace.id, workspace);
  }

  async findById(id: WorkspaceId): Promise<Workspace | null> {
    return this.workspaces.get(id) ?? null;
  }
}

class InMemoryAgentRepository implements AgentRepository {
  private readonly agents = new Map<AgentId, Agent>();
  private readonly versions = new Map<AgentVersionId, AgentVersion>();

  async saveAgent(agent: Agent): Promise<void> {
    this.agents.set(agent.id, agent);
  }

  async findAgentById(id: AgentId): Promise<Agent | null> {
    return this.agents.get(id) ?? null;
  }

  async listAgents(): Promise<Agent[]> {
    return [...this.agents.values()];
  }

  async updateAgentMetadata(): Promise<Agent | null> {
    return null;
  }

  async saveAgentVersion(agentVersion: AgentVersion): Promise<void> {
    this.versions.set(agentVersion.id, agentVersion);
  }

  async appendAgentVersion(): Promise<AgentVersion> {
    throw new Error("not implemented");
  }

  async findAgentVersionById(id: AgentVersionId): Promise<AgentVersion | null> {
    return this.versions.get(id) ?? null;
  }

  async listAgentVersions(): Promise<AgentVersion[]> {
    return [...this.versions.values()];
  }
}

class InMemoryWorkflowRepository implements WorkflowRepository {
  private readonly workflows = new Map<WorkflowId, Workflow>();
  private readonly versions = new Map<WorkflowVersionId, WorkflowVersion>();

  async saveWorkflow(workflow: Workflow): Promise<void> {
    this.workflows.set(workflow.id, workflow);
  }

  async findWorkflowById(id: WorkflowId): Promise<Workflow | null> {
    return this.workflows.get(id) ?? null;
  }

  async listWorkflows(): Promise<Workflow[]> {
    return [...this.workflows.values()];
  }

  async saveWorkflowVersion(workflowVersion: WorkflowVersion): Promise<void> {
    this.versions.set(workflowVersion.id, workflowVersion);
  }

  async appendWorkflowVersion(input: {
    readonly id: WorkflowVersionId;
    readonly workflowId: WorkflowId;
    readonly definition: WorkflowDefinitionV1;
    readonly createdAt: Date;
  }): Promise<WorkflowVersion> {
    const workflow = this.workflows.get(input.workflowId);
    if (workflow === undefined) {
      throw new Error("workflow missing");
    }

    let maxVersion = 0;
    for (const stored of this.versions.values()) {
      if (
        stored.workflowId === input.workflowId &&
        stored.version > maxVersion
      ) {
        maxVersion = stored.version;
      }
    }

    const version = WorkflowVersion.create({
      id: input.id,
      workflowId: input.workflowId,
      workspaceId: workflow.workspaceId,
      version: maxVersion + 1,
      definition: input.definition,
      createdAt: input.createdAt,
    });
    this.versions.set(version.id, version);
    return version;
  }

  async findWorkflowVersionById(
    id: WorkflowVersionId,
  ): Promise<WorkflowVersion | null> {
    return this.versions.get(id) ?? null;
  }

  async listWorkflowVersions(
    workflowId: WorkflowId,
  ): Promise<WorkflowVersion[]> {
    return [...this.versions.values()].filter(
      (version) => version.workflowId === workflowId,
    );
  }
}

class InMemoryWorkflowRunRepository implements WorkflowRunRepository {
  private readonly runs = new Map<
    import("@osva/contracts").WorkflowRunId,
    import("../src/workflow-run.js").WorkflowRun
  >();

  async saveWorkflowRun(
    workflowRun: import("../src/workflow-run.js").WorkflowRun,
  ): Promise<void> {
    this.runs.set(workflowRun.id, workflowRun);
  }

  async findWorkflowRunById(
    id: import("@osva/contracts").WorkflowRunId,
  ): Promise<import("../src/workflow-run.js").WorkflowRun | null> {
    return this.runs.get(id) ?? null;
  }

  async listActiveWorkflowRuns(): Promise<
    readonly import("../src/workflow-run.js").WorkflowRun[]
  > {
    return [...this.runs.values()];
  }

  async transitionWorkflowRun(
    _expectedStatus: import("@osva/contracts").WorkflowRunState,
    next: import("../src/workflow-run.js").WorkflowRun,
  ): Promise<import("../src/workflow-run.js").WorkflowRun> {
    this.runs.set(next.id, next);
    return next;
  }

  async saveWorkflowNodeRun(): Promise<void> {}

  async findWorkflowNodeRunById(): Promise<null> {
    return null;
  }

  async findWorkflowNodeRunByWorkflowRunAndKey(): Promise<null> {
    return null;
  }

  async listWorkflowNodeRuns(): Promise<readonly never[]> {
    return [];
  }

  async saveWorkflowNodeRunTransition(
    _expectedStatus: import("../src/workflow-node-run.js").WorkflowNodeRun["status"],
    next: import("../src/workflow-node-run.js").WorkflowNodeRun,
  ): Promise<import("../src/workflow-node-run.js").WorkflowNodeRun> {
    return next;
  }
}
