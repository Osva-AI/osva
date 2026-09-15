import {
  MemoryAgentRepository,
  MemoryJobQueue,
  MemoryRunRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import { Agent, Workspace } from "@osva/domain";
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
  createBindings,
  otherAgentId,
  otherAgentVersionId,
  otherWorkspaceId,
  runAttemptId,
  runId,
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
    effectiveBindings: createBindings(),
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
      async saveRun(run) {
        statuses.push(run.status);
        await inner.saveRun(run);
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
        effectiveBindings: createBindings(otherAgentVersionId),
      }),
    ).rejects.toBeInstanceOf(BindingMismatchError);

    expect(await runs.findRunById(runId)).toBeNull();
    expect(await runs.findRunAttemptById(runAttemptId)).toBeNull();
    expect(queue.pendingRunAttemptIds()).toEqual([]);
  });
});
