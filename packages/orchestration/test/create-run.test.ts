import type { ModelProfileId, ToolVersionId } from "@osva/contracts";
import {
  MemoryAgentRepository,
  MemoryJobQueue,
  MemoryMemoryNamespaceRepository,
  MemoryModelProfileRepository,
  MemoryToolRepository,
  MemoryRunRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import {
  Agent,
  AgentVersion,
  ModelProfile,
  ModelProfileVersion,
  Workspace,
  createAgentApplication,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { CreateRun } from "../src/create-run.js";
import {
  AgentNotFoundError,
  AgentVersionNotFoundError,
  BindingMismatchError,
  EnqueueFailedError,
} from "../src/errors.js";
import {
  FailingJobQueue,
  NOW,
  RUN_INPUT,
  agentId,
  agentVersionId,
  createManifest,
  modelProfileVersionId,
  otherAgentId,
  otherAgentVersionId,
  otherWorkspaceId,
  runAttemptId,
  runId,
  secondaryModelProfileVersionId,
  seedAgentGraph,
  workspaceId,
  wrapRunRepository,
} from "./fixtures.js";

function createCommand() {
  return {
    runId,
    runAttemptId,
    workspaceId,
    agentId,
    agentVersionId,
    input: RUN_INPUT,
    now: NOW,
  };
}

describe("CreateRun", () => {
  it("persists QUEUED Run and PENDING attempt before enqueue when Agent and AgentVersion are valid", async () => {
    const workspaces = new MemoryWorkspaceRepository();
    const agents = new MemoryAgentRepository();
    const inner = new MemoryRunRepository();
    const statuses: string[] = [];
    const runs = wrapRunRepository(inner, {
      async createRunWithInitialAttempt(run, attempt) {
        statuses.push(run.status);
        await inner.createRunWithInitialAttempt(run, attempt);
      },
      async transitionRun(expectedStatus, next) {
        statuses.push(next.status);
        return inner.transitionRun(expectedStatus, next);
      },
    });
    const queue = new MemoryJobQueue();
    await seedAgentGraph(workspaces, agents);

    const createRun = new CreateRun({ runs, agents, queue });
    const result = await createRun.execute({
      ...createCommand(),
      idempotencyKey: "idem-1",
    });

    expect(statuses).toEqual(["PENDING", "QUEUED"]);
    expect(result.run.status).toBe("QUEUED");
    expect(result.run.idempotencyKey).toBe("idem-1");
    expect(result.run.effectiveBindings.agentVersionId).toBe(agentVersionId);
    expect(result.run.effectiveBindings.modelProfileVersionBindings).toEqual(
      {},
    );
    expect(queue.pendingRunAttemptIds()).toEqual([runAttemptId]);
  });

  it("leaves recoverable QUEUED/PENDING state when enqueue fails", async () => {
    const workspaces = new MemoryWorkspaceRepository();
    const agents = new MemoryAgentRepository();
    const runs = new MemoryRunRepository();
    await seedAgentGraph(workspaces, agents);

    const createRun = new CreateRun({
      runs,
      agents,
      queue: new FailingJobQueue(),
    });

    await expect(createRun.execute(createCommand())).rejects.toBeInstanceOf(
      EnqueueFailedError,
    );

    const persistedRun = await runs.findRunById(runId);
    const persistedAttempt = await runs.findRunAttemptById(runAttemptId);
    expect(persistedRun?.status).toBe("QUEUED");
    expect(persistedAttempt?.status).toBe("PENDING");
    expect(persistedAttempt?.sequence).toBe(1);
  });

  it("rejects a nonexistent Agent before persist or enqueue", async () => {
    const agents = new MemoryAgentRepository();
    const runs = new MemoryRunRepository();
    const queue = new MemoryJobQueue();
    const createRun = new CreateRun({ runs, agents, queue });

    await expect(createRun.execute(createCommand())).rejects.toBeInstanceOf(
      AgentNotFoundError,
    );

    expect(await runs.findRunById(runId)).toBeNull();
    expect(await runs.findRunAttemptById(runAttemptId)).toBeNull();
    expect(queue.pendingRunAttemptIds()).toEqual([]);
  });

  it("rejects an Agent from another Workspace before persist or enqueue", async () => {
    const workspaces = new MemoryWorkspaceRepository();
    const agents = new MemoryAgentRepository();
    const runs = new MemoryRunRepository();
    const queue = new MemoryJobQueue();
    await seedAgentGraph(workspaces, agents, {
      workspaceId: otherWorkspaceId,
    });

    const createRun = new CreateRun({ runs, agents, queue });

    await expect(createRun.execute(createCommand())).rejects.toBeInstanceOf(
      BindingMismatchError,
    );

    expect(await runs.findRunById(runId)).toBeNull();
    expect(await runs.findRunAttemptById(runAttemptId)).toBeNull();
    expect(queue.pendingRunAttemptIds()).toEqual([]);
  });

  it("rejects a nonexistent AgentVersion before persist or enqueue", async () => {
    const workspaces = new MemoryWorkspaceRepository();
    const agents = new MemoryAgentRepository();
    const runs = new MemoryRunRepository();
    const queue = new MemoryJobQueue();
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
        key: "agent-key",
        name: "Example Agent",
        createdAt: NOW,
      }),
    );

    const createRun = new CreateRun({ runs, agents, queue });

    await expect(createRun.execute(createCommand())).rejects.toBeInstanceOf(
      AgentVersionNotFoundError,
    );

    expect(await runs.findRunById(runId)).toBeNull();
    expect(await runs.findRunAttemptById(runAttemptId)).toBeNull();
    expect(queue.pendingRunAttemptIds()).toEqual([]);
  });

  it("rejects an AgentVersion belonging to another Agent before persist or enqueue", async () => {
    const workspaces = new MemoryWorkspaceRepository();
    const agents = new MemoryAgentRepository();
    const runs = new MemoryRunRepository();
    const queue = new MemoryJobQueue();
    await seedAgentGraph(workspaces, agents);
    await seedAgentGraph(workspaces, agents, {
      agentId: otherAgentId,
      agentVersionId: otherAgentVersionId,
      key: "other-agent",
    });

    const createRun = new CreateRun({ runs, agents, queue });

    await expect(
      createRun.execute({
        ...createCommand(),
        agentVersionId: otherAgentVersionId,
      }),
    ).rejects.toBeInstanceOf(BindingMismatchError);

    expect(await runs.findRunById(runId)).toBeNull();
    expect(await runs.findRunAttemptById(runAttemptId)).toBeNull();
    expect(queue.pendingRunAttemptIds()).toEqual([]);
  });

  it("accepts an AgentVersion created through the Agent Registry", async () => {
    const workspaces = new MemoryWorkspaceRepository();
    const agents = new MemoryAgentRepository();
    const runs = new MemoryRunRepository();
    const queue = new MemoryJobQueue();
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );

    let counter = 0;
    const registry = createAgentApplication({
      agents,
      workspaces,
      modelProfiles: new MemoryModelProfileRepository(),
      tools: new MemoryToolRepository(),
      memoryNamespaces: new MemoryMemoryNamespaceRepository(),
      knowledge: {
        findIndexById: async () => null,
      } as unknown as import("@osva/domain").KnowledgeRepository,
      clock: { now: () => NOW },
      ids: {
        createId() {
          counter += 1;
          return counter === 1 ? agentId : agentVersionId;
        },
      },
    });

    await registry.createAgent.execute({
      workspaceId,
      key: "agent-key",
      name: "Example Agent",
    });
    await registry.appendAgentVersion.execute({
      agentId,
      manifest: createManifest(),
    });

    const createRun = new CreateRun({ runs, agents, queue });
    const result = await createRun.execute(createCommand());

    expect(result.run.status).toBe("QUEUED");
    expect(result.run.agentId).toBe(agentId);
    expect(result.run.effectiveBindings.agentVersionId).toBe(agentVersionId);
    expect(result.run.effectiveBindings.modelProfileVersionBindings).toEqual(
      {},
    );
    expect(queue.pendingRunAttemptIds()).toEqual([runAttemptId]);
  });

  it("copies AgentVersion model bindings into immutable Run effectiveBindings", async () => {
    const workspaces = new MemoryWorkspaceRepository();
    const agents = new MemoryAgentRepository();
    const runs = new MemoryRunRepository();
    const queue = new MemoryJobQueue();
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
        key: "agent-key",
        name: "Example Agent",
        createdAt: NOW,
      }),
    );
    await agents.saveAgentVersion(
      AgentVersion.create({
        id: agentVersionId,
        agentId,
        version: 1,
        manifest: createManifest({
          models: {
            primary: { modelProfileVersionId },
          },
        }),
        createdAt: NOW,
      }),
    );

    const createRun = new CreateRun({ runs, agents, queue });
    const result = await createRun.execute(createCommand());
    expect(result.run.effectiveBindings.modelProfileVersionBindings).toEqual({
      primary: modelProfileVersionId,
    });

    await agents.saveAgentVersion(
      AgentVersion.create({
        id: otherAgentVersionId,
        agentId,
        version: 2,
        manifest: createManifest({
          models: {
            primary: {
              modelProfileVersionId: secondaryModelProfileVersionId,
            },
          },
        }),
        createdAt: NOW,
      }),
    );

    const persisted = await runs.findRunById(runId);
    expect(persisted?.effectiveBindings.modelProfileVersionBindings).toEqual({
      primary: modelProfileVersionId,
    });
  });

  it("does not change a Run binding when a newer ModelProfileVersion is appended", async () => {
    const workspaces = new MemoryWorkspaceRepository();
    const agents = new MemoryAgentRepository();
    const modelProfiles = new MemoryModelProfileRepository();
    const runs = new MemoryRunRepository();
    const queue = new MemoryJobQueue();
    const modelProfileId = "model-profile-1" as ModelProfileId;
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
        key: "agent-key",
        name: "Example Agent",
        createdAt: NOW,
      }),
    );
    await modelProfiles.saveModelProfile(
      ModelProfile.create({
        id: modelProfileId,
        workspaceId,
        key: "primary",
        name: "Primary",
        createdAt: NOW,
      }),
    );
    await modelProfiles.saveModelProfileVersion(
      ModelProfileVersion.create({
        id: modelProfileVersionId,
        modelProfileId,
        version: 1,
        provider: "OPENAI",
        model: "gpt-one",
        createdAt: NOW,
      }),
    );
    await agents.saveAgentVersion(
      AgentVersion.create({
        id: agentVersionId,
        agentId,
        version: 1,
        manifest: createManifest({
          models: {
            primary: { modelProfileVersionId },
          },
        }),
        createdAt: NOW,
      }),
    );

    const createRun = new CreateRun({ runs, agents, queue });
    const result = await createRun.execute(createCommand());
    expect(result.run.effectiveBindings.modelProfileVersionBindings).toEqual({
      primary: modelProfileVersionId,
    });

    const newer = await modelProfiles.appendModelProfileVersion({
      id: secondaryModelProfileVersionId,
      modelProfileId,
      provider: "OPENAI",
      model: "gpt-two",
      createdAt: NOW,
    });
    expect(newer.version).toBe(2);

    const persisted = await runs.findRunById(runId);
    expect(persisted?.effectiveBindings.modelProfileVersionBindings).toEqual({
      primary: modelProfileVersionId,
    });
  });

  it("copies AgentVersion tool bindings into immutable Run effectiveBindings", async () => {
    const workspaces = new MemoryWorkspaceRepository();
    const agents = new MemoryAgentRepository();
    const runs = new MemoryRunRepository();
    const queue = new MemoryJobQueue();
    const toolVersionId = "tool-version-1" as ToolVersionId;
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
        key: "agent-key",
        name: "Example Agent",
        createdAt: NOW,
      }),
    );
    await agents.saveAgentVersion(
      AgentVersion.create({
        id: agentVersionId,
        agentId,
        version: 1,
        manifest: createManifest({
          tools: {
            echo: { toolVersionId },
          },
        }),
        createdAt: NOW,
      }),
    );

    const createRun = new CreateRun({ runs, agents, queue });
    const result = await createRun.execute(createCommand());
    expect(result.run.effectiveBindings.toolVersionBindings).toEqual({
      echo: toolVersionId,
    });

    await agents.saveAgentVersion(
      AgentVersion.create({
        id: otherAgentVersionId,
        agentId,
        version: 2,
        manifest: createManifest({
          tools: {
            echo: { toolVersionId: "tool-version-2" as ToolVersionId },
          },
        }),
        createdAt: NOW,
      }),
    );

    const persisted = await runs.findRunById(runId);
    expect(persisted?.effectiveBindings.toolVersionBindings).toEqual({
      echo: toolVersionId,
    });
  });

  it("copies AgentVersion knowledge bindings into immutable Run effectiveBindings", async () => {
    const workspaces = new MemoryWorkspaceRepository();
    const agents = new MemoryAgentRepository();
    const runs = new MemoryRunRepository();
    const queue = new MemoryJobQueue();
    const indexA = "ki-a" as import("@osva/contracts").KnowledgeIndexId;
    const indexB = "ki-b" as import("@osva/contracts").KnowledgeIndexId;
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
        key: "agent-key",
        name: "Example Agent",
        createdAt: NOW,
      }),
    );
    await agents.saveAgentVersion(
      AgentVersion.create({
        id: agentVersionId,
        agentId,
        version: 1,
        manifest: createManifest({
          knowledge: {
            company_docs: { knowledgeIndexIds: [indexA] },
          },
        }),
        createdAt: NOW,
      }),
    );

    const createRun = new CreateRun({ runs, agents, queue });
    const result = await createRun.execute(createCommand());
    expect(result.run.effectiveBindings.knowledgeIndexBindings).toEqual({
      company_docs: [indexA],
    });

    await agents.saveAgentVersion(
      AgentVersion.create({
        id: otherAgentVersionId,
        agentId,
        version: 2,
        manifest: createManifest({
          knowledge: {
            company_docs: { knowledgeIndexIds: [indexB] },
          },
        }),
        createdAt: NOW,
      }),
    );

    const persisted = await runs.findRunById(runId);
    expect(persisted?.effectiveBindings.knowledgeIndexBindings).toEqual({
      company_docs: [indexA],
    });
  });
});
