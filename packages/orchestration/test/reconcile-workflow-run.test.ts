import type {
  AgentVersionId,
  RunAttemptId,
  RunId,
  WorkflowNodeRunId,
} from "@osva/contracts";
import {
  FakeRuntimeAdapter,
  MemoryAgentRepository,
  MemoryJobQueue,
  MemoryRunRepository,
  MemoryWorkflowRepository,
  MemoryWorkflowRunRepository,
  MemoryApprovalRequestRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import { createWorkflowApplication } from "@osva/domain";
import { describe, expect, it } from "vitest";

import { CreateRun } from "../src/create-run.js";
import { ExecuteRunAttempt } from "../src/execute-run-attempt.js";
import { ReconcileWorkflowRun } from "../src/reconcile-workflow-run.js";
import { WorkflowOrchestratorTick } from "../src/workflow-orchestrator-tick.js";
import { LATER, NOW, seedAgentGraph, workspaceId } from "./fixtures.js";
import { wrapRunRepository } from "./fixtures.js";

describe("sequential workflow orchestration", () => {
  it("executes Agent A then Agent B and copies output as input", async () => {
    const harness = await createHarness();
    const { agentA, agentB } = await seedAgents(harness);
    const version = await createSequentialVersion(harness, [
      ["research", agentA],
      ["summarize", agentB],
    ]);
    const workflowRun = await harness.app.createWorkflowRun.execute({
      workspaceId,
      workflowVersionId: version.id,
      input: { topic: "osva" },
    });

    await runUntilTerminal(harness, workflowRun.id);

    const view = await harness.app.getWorkflowRun.execute(workflowRun.id);
    expect(view.workflowRun.status).toBe("SUCCEEDED");
    expect(view.workflowRun.output).toEqual({
      from: "summarize",
      received: { from: "research", received: { topic: "osva" } },
    });
    expect(view.nodeRuns).toHaveLength(2);
    expect(view.nodeRuns[0]?.status).toBe("SUCCEEDED");
    expect(view.nodeRuns[1]?.input).toEqual(view.nodeRuns[0]?.output);
    expect(view.nodeRuns[1]?.status).toBe("SUCCEEDED");
    const firstAttempts = await harness.runs.listRunAttempts(
      view.nodeRuns[0]!.childRunId!,
    );
    expect(firstAttempts.map((attempt) => attempt.sequence)).toEqual([1]);
  });

  it("fails the workflow when a middle node fails and does not start later nodes", async () => {
    const harness = await createHarness({ failNodes: new Set(["summarize"]) });
    const { agentA, agentB, agentC } = await seedAgents(harness);
    const version = await createSequentialVersion(harness, [
      ["research", agentA],
      ["summarize", agentB],
      ["publish", agentC],
    ]);
    const workflowRun = await harness.app.createWorkflowRun.execute({
      workspaceId,
      workflowVersionId: version.id,
      input: { topic: "osva" },
    });

    await runUntilTerminal(harness, workflowRun.id);

    const view = await harness.app.getWorkflowRun.execute(workflowRun.id);
    expect(view.workflowRun.status).toBe("FAILED");
    expect(view.nodeRuns.map((node) => node.workflowNodeKey)).toEqual([
      "research",
      "summarize",
    ]);
    expect(view.nodeRuns[0]?.status).toBe("SUCCEEDED");
    expect(view.nodeRuns[1]?.status).toBe("FAILED");
  });

  it("reuses the same child Run and RunAttempt sequence 1 across repeated reconciliation", async () => {
    const harness = await createHarness();
    const { agentA, agentB } = await seedAgents(harness);
    const version = await createSequentialVersion(harness, [
      ["research", agentA],
      ["summarize", agentB],
    ]);
    const workflowRun = await harness.app.createWorkflowRun.execute({
      workspaceId,
      workflowVersionId: version.id,
      input: { topic: "osva" },
    });

    await harness.tick.execute(NOW, harness.ids);
    await harness.tick.execute(NOW, harness.ids);
    await harness.tick.execute(NOW, harness.ids);

    const afterRedelivery = await harness.app.getWorkflowRun.execute(
      workflowRun.id,
    );
    expect(afterRedelivery.nodeRuns).toHaveLength(1);
    const childRunId = afterRedelivery.nodeRuns[0]?.childRunId;
    expect(childRunId).toBeTruthy();
    const attempts = await harness.runs.listRunAttempts(childRunId!);
    expect(attempts.map((attempt) => attempt.sequence)).toEqual([1]);
    expect(harness.runsCreated).toBe(1);

    await runUntilTerminal(harness, workflowRun.id);

    const finished = await harness.app.getWorkflowRun.execute(workflowRun.id);
    expect(finished.workflowRun.status).toBe("SUCCEEDED");
    expect(finished.nodeRuns).toHaveLength(2);
    expect(
      (
        await harness.runs.listRunAttempts(finished.nodeRuns[0]!.childRunId!)
      ).map((attempt) => attempt.sequence),
    ).toEqual([1]);
    expect(
      (
        await harness.runs.listRunAttempts(finished.nodeRuns[1]!.childRunId!)
      ).map((attempt) => attempt.sequence),
    ).toEqual([1]);
    expect(harness.runsCreated).toBe(2);
  });
});

async function seedAgents(harness: TestHarness) {
  await seedAgentGraph(harness.workspaces, harness.agents, {
    agentId: "agent-a" as never,
    agentVersionId: "agent-version-a" as AgentVersionId,
    key: "agent-a",
  });
  await seedAgentGraph(harness.workspaces, harness.agents, {
    workspaceId,
    agentId: "agent-b" as never,
    agentVersionId: "agent-version-b" as AgentVersionId,
    key: "agent-b",
  });
  await seedAgentGraph(harness.workspaces, harness.agents, {
    workspaceId,
    agentId: "agent-c" as never,
    agentVersionId: "agent-version-c" as AgentVersionId,
    key: "agent-c",
  });
  return {
    agentA: "agent-version-a" as AgentVersionId,
    agentB: "agent-version-b" as AgentVersionId,
    agentC: "agent-version-c" as AgentVersionId,
  };
}

async function createSequentialVersion(
  harness: TestHarness,
  nodes: ReadonlyArray<readonly [string, AgentVersionId]>,
) {
  const workflow = await harness.app.createWorkflow.execute({
    workspaceId,
    key: "research-report",
    name: "Research Report",
  });
  return harness.app.appendWorkflowVersion.execute({
    workflowId: workflow.id,
    definition: {
      schemaVersion: "1",
      nodes: nodes.map(([key, agentVersionId]) => ({
        key,
        type: "AGENT",
        agentVersionId,
      })),
      edges: nodes.slice(1).map((_, index) => ({
        from: nodes[index]![0],
        to: nodes[index + 1]![0],
      })),
    },
  });
}

async function runUntilTerminal(
  harness: TestHarness,
  workflowRunId: Parameters<TestHarness["app"]["getWorkflowRun"]["execute"]>[0],
): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await harness.tick.execute(LATER, harness.ids);
    await harness.queue.consume(async (payload) => {
      await harness.execute.execute({
        runAttemptId: payload.runAttemptId,
        now: LATER,
      });
    });
    const view = await harness.app.getWorkflowRun.execute(workflowRunId);
    if (
      view.workflowRun.status === "SUCCEEDED" ||
      view.workflowRun.status === "FAILED"
    ) {
      return;
    }
  }

  throw new Error("workflow did not reach a terminal status");
}

interface TestHarness {
  readonly app: ReturnType<typeof createWorkflowApplication>;
  readonly agents: MemoryAgentRepository;
  readonly workspaces: MemoryWorkspaceRepository;
  readonly runs: MemoryRunRepository;
  readonly queue: MemoryJobQueue;
  readonly tick: WorkflowOrchestratorTick;
  readonly execute: ExecuteRunAttempt;
  readonly runsCreated: number;
  readonly ids: {
    createRunId(): RunId;
    createRunAttemptId(): RunAttemptId;
    createWorkflowNodeRunId(): WorkflowNodeRunId;
    createApprovalRequestId(): import("@osva/contracts").ApprovalRequestId;
  };
}

async function createHarness(options?: {
  readonly failNodes?: Set<string>;
}): Promise<TestHarness> {
  const workspaces = new MemoryWorkspaceRepository();
  const agents = new MemoryAgentRepository();
  const innerRuns = new MemoryRunRepository();
  let runsCreated = 0;
  const runs = wrapRunRepository(innerRuns, {
    createRunWithInitialAttempt: async (run, attempt) => {
      runsCreated += 1;
      return innerRuns.createRunWithInitialAttempt(run, attempt);
    },
  });
  const workflows = new MemoryWorkflowRepository();
  const workflowRuns = new MemoryWorkflowRunRepository();
  const approvalRequests = new MemoryApprovalRequestRepository();
  const queue = new MemoryJobQueue();
  let attemptCounter = 0;
  let nodeCounter = 0;
  let workflowCounter = 0;
  const createRun = new CreateRun({ runs, agents, queue });
  const execute = new ExecuteRunAttempt({
    runs,
    agents,
    runtime: new FakeRuntimeAdapter(async (request) => {
      const nodeKey = nodeKeyForAgent(request.agentVersionId);
      if (options?.failNodes?.has(nodeKey)) {
        return {
          status: "failed",
          error: { code: "RUNTIME_FAILED", message: "node failed" },
        };
      }

      return {
        status: "succeeded",
        output: { from: nodeKey, received: request.input },
      };
    }),
  });
  const reconcile = new ReconcileWorkflowRun({
    workflows,
    workflowRuns,
    approvalRequests,
    agents,
    runs,
    createRun,
    queue,
  });
  const tick = new WorkflowOrchestratorTick({
    workflowRuns,
    reconcile,
  });
  const app = createWorkflowApplication({
    workflows,
    workflowRuns,
    approvalRequests,
    agents,
    workspaces,
    clock: { now: () => NOW },
    ids: {
      createId() {
        workflowCounter += 1;
        return `wf-${String(workflowCounter)}`;
      },
    },
  });

  return {
    app,
    agents,
    workspaces,
    runs: innerRuns,
    queue,
    tick,
    execute,
    get runsCreated() {
      return runsCreated;
    },
    ids: {
      createRunId: () => `run-${String(runsCreated + 1)}` as RunId,
      createRunAttemptId: () => {
        attemptCounter += 1;
        return `attempt-${String(attemptCounter)}` as RunAttemptId;
      },
      createWorkflowNodeRunId: () => {
        nodeCounter += 1;
        return `node-run-${String(nodeCounter)}` as WorkflowNodeRunId;
      },
      createApprovalRequestId: () => {
        nodeCounter += 1;
        return `approval-${String(nodeCounter)}` as import("@osva/contracts").ApprovalRequestId;
      },
    },
  };
}

function nodeKeyForAgent(agentVersionId: string): string {
  if (agentVersionId === "agent-version-a") {
    return "research";
  }

  if (agentVersionId === "agent-version-b") {
    return "summarize";
  }

  return "publish";
}
