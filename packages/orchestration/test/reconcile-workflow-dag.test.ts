import type {
  AgentVersionId,
  RunAttemptId,
  RunId,
  WorkflowDefinitionV2,
  WorkflowNodeRunId,
  WorkflowRunId,
} from "@osva/contracts";
import {
  FakeRuntimeAdapter,
  MemoryAgentRepository,
  MemoryJobQueue,
  MemoryRunRepository,
  MemoryWorkflowRepository,
  MemoryWorkflowRunRepository,
  MemoryWorkflowWaitRepository,
  MemoryApprovalRequestRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import { createWorkflowApplication } from "@osva/domain";
import { describe, expect, it } from "vitest";

import { CreateRun } from "../src/create-run.js";
import { ExecuteRunAttempt } from "../src/execute-run-attempt.js";
import { ReconcileWorkflowRun } from "../src/reconcile-workflow-run.js";
import { WorkflowOrchestratorTick } from "../src/workflow-orchestrator-tick.js";
import {
  LATER,
  NOW,
  seedAgentGraph,
  workspaceId,
  orchScope,
} from "./fixtures.js";
import { wrapRunRepository } from "./fixtures.js";

describe("DAG workflow orchestration", () => {
  it("executes V2 sequential AGENT graphs like V1", async () => {
    const harness = await createHarness();
    const { agentA, agentB } = await seedAgents(harness);
    const version = await createVersion(harness, {
      schemaVersion: "2",
      nodes: [
        { key: "research", type: "AGENT", agentVersionId: agentA },
        { key: "summarize", type: "AGENT", agentVersionId: agentB },
      ],
      edges: [{ from: "research", to: "summarize" }],
    });
    const workflowRun = await harness.app.createWorkflowRun.execute(
      orchScope(),
      {
        workspaceId,
        workflowVersionId: version.id,
        input: { topic: "osva" },
      },
    );

    await runUntilTerminal(harness, workflowRun.id);
    const view = await harness.app.getWorkflowRun.execute(
      orchScope(),
      workflowRun.id,
    );
    expect(view.workflowRun.status).toBe("SUCCEEDED");
    expect(view.nodeRuns.map((node) => node.workflowNodeKey)).toEqual([
      "research",
      "summarize",
    ]);
    expect(view.nodeRuns[1]?.input).toEqual(view.nodeRuns[0]?.output);
  });

  it("selects one BRANCH path, skips the other, and keeps the BRANCH input", async () => {
    const harness = await createHarness();
    const { agentA, agentB } = await seedAgents(harness);
    const version = await createVersion(
      harness,
      branchJoinDefinition(agentA, agentB),
    );
    const workflowRun = await harness.app.createWorkflowRun.execute(
      orchScope(),
      {
        workspaceId,
        workflowVersionId: version.id,
        input: { category: "sales" },
      },
    );

    await runUntilTerminal(harness, workflowRun.id);
    const view = await harness.app.getWorkflowRun.execute(
      orchScope(),
      workflowRun.id,
    );
    expect(view.workflowRun.status).toBe("SUCCEEDED");
    const byKey = byNodeKey(view.nodeRuns);
    expect(byKey.route?.status).toBe("SUCCEEDED");
    expect(byKey.route?.selectedTargetKey).toBe("b");
    expect(byKey.b?.status).toBe("SUCCEEDED");
    expect(byKey.b?.input).toEqual(byKey.route?.input);
    expect(byKey.c?.status).toBe("SKIPPED");
    expect(byKey.b?.childRunId).toBeTruthy();
    expect(byKey.c?.childRunId).toBeUndefined();
    expect(byKey.join?.status).toBe("SUCCEEDED");
    expect(byKey.join?.input).toEqual({ b: byKey.b?.output });
    expect(byKey.d?.status).toBe("SUCCEEDED");
  });

  it("uses the BRANCH default when the selector is missing", async () => {
    const harness = await createHarness();
    const { agentA, agentB } = await seedAgents(harness);
    const version = await createVersion(
      harness,
      branchJoinDefinition(agentA, agentB),
    );
    const workflowRun = await harness.app.createWorkflowRun.execute(
      orchScope(),
      {
        workspaceId,
        workflowVersionId: version.id,
        input: {},
      },
    );

    await runUntilTerminal(harness, workflowRun.id);
    const view = await harness.app.getWorkflowRun.execute(
      orchScope(),
      workflowRun.id,
    );
    const byKey = byNodeKey(view.nodeRuns);
    expect(byKey.route?.selectedTargetKey).toBe("c");
    expect(byKey.c?.status).toBe("SUCCEEDED");
    expect(byKey.b?.status).toBe("SKIPPED");
    expect(byKey.join?.input).toEqual({ c: byKey.c?.output });
  });

  it("does not change a BRANCH decision across repeated reconciliation", async () => {
    const harness = await createHarness();
    const { agentA, agentB } = await seedAgents(harness);
    const version = await createVersion(
      harness,
      branchJoinDefinition(agentA, agentB),
    );
    const workflowRun = await harness.app.createWorkflowRun.execute(
      orchScope(),
      {
        workspaceId,
        workflowVersionId: version.id,
        input: { category: "sales" },
      },
    );

    await runUntilTerminal(harness, workflowRun.id);
    await harness.tick.execute(LATER, harness.ids);
    await harness.tick.execute(LATER, harness.ids);
    const view = await harness.app.getWorkflowRun.execute(
      orchScope(),
      workflowRun.id,
    );
    const route = view.nodeRuns.find(
      (node) => node.workflowNodeKey === "route",
    );
    expect(route?.selectedTargetKey).toBe("b");
    expect(
      view.nodeRuns.filter((node) => node.workflowNodeKey === "route"),
    ).toHaveLength(1);
  });

  it("propagates SKIPPED through inactive descendants and skips an all-skipped JOIN", async () => {
    const harness = await createHarness();
    const { agentA, agentB } = await seedAgents(harness);
    const version = await createVersion(
      harness,
      skipJoinDefinition(agentA, agentB),
    );
    const workflowRun = await harness.app.createWorkflowRun.execute(
      orchScope(),
      {
        workspaceId,
        workflowVersionId: version.id,
        input: { category: "keep" },
      },
    );

    await runUntilTerminal(harness, workflowRun.id);
    const view = await harness.app.getWorkflowRun.execute(
      orchScope(),
      workflowRun.id,
    );
    const byKey = byNodeKey(view.nodeRuns);
    expect(byKey.keep?.status).toBe("SUCCEEDED");
    expect(byKey.left?.status).toBe("SKIPPED");
    expect(byKey.x?.status).toBe("SKIPPED");
    expect(byKey.y?.status).toBe("SKIPPED");
    expect(byKey.skippedJoin?.status).toBe("SKIPPED");
    expect(byKey.skippedJoin?.childRunId).toBeUndefined();
    expect(byKey.merge?.status).toBe("SUCCEEDED");
    expect(byKey.merge?.input).toEqual({ keep: byKey.keep?.output });
    expect(view.workflowRun.status).toBe("SUCCEEDED");
  });

  it("runs PARALLEL children independently and joins deterministically", async () => {
    const harness = await createHarness();
    const { agentA, agentB, agentC } = await seedAgents(harness);
    const version = await createVersion(
      harness,
      parallelDefinition(agentA, agentB, agentC),
    );
    const workflowRun = await harness.app.createWorkflowRun.execute(
      orchScope(),
      {
        workspaceId,
        workflowVersionId: version.id,
        input: { topic: "osva" },
      },
    );

    await runUntilTerminal(harness, workflowRun.id);
    const view = await harness.app.getWorkflowRun.execute(
      orchScope(),
      workflowRun.id,
    );
    const byKey = byNodeKey(view.nodeRuns);
    expect(byKey.b?.status).toBe("SUCCEEDED");
    expect(byKey.c?.status).toBe("SUCCEEDED");
    expect(byKey.b?.childRunId).toBeTruthy();
    expect(byKey.c?.childRunId).toBeTruthy();
    expect(byKey.b?.childRunId).not.toBe(byKey.c?.childRunId);
    expect(byKey.join?.input).toEqual({
      b: byKey.b?.output,
      c: byKey.c?.output,
    });
    expect(Object.keys(byKey.join?.input as object)).toEqual(["b", "c"]);
    expect(byKey.d?.status).toBe("SUCCEEDED");
    expect(view.workflowRun.status).toBe("SUCCEEDED");
    expect(harness.runsCreated).toBe(4);
  });

  it("fails the workflow when one parallel path fails and does not resurrect on sibling success", async () => {
    const harness = await createHarness({
      failAgentVersionIds: new Set(["agent-version-b"]),
    });
    const { agentA, agentB, agentC } = await seedAgents(harness);
    const version = await createVersion(
      harness,
      parallelDefinition(agentA, agentB, agentC),
    );
    const workflowRun = await harness.app.createWorkflowRun.execute(
      orchScope(),
      {
        workspaceId,
        workflowVersionId: version.id,
        input: { topic: "osva" },
      },
    );

    await runUntilTerminal(harness, workflowRun.id);
    let view = await harness.app.getWorkflowRun.execute(
      orchScope(),
      workflowRun.id,
    );
    expect(view.workflowRun.status).toBe("FAILED");
    expect(
      view.nodeRuns.find((node) => node.workflowNodeKey === "join"),
    ).toBeUndefined();
    expect(
      view.nodeRuns.find((node) => node.workflowNodeKey === "d"),
    ).toBeUndefined();

    await harness.tick.execute(LATER, harness.ids);
    await harness.queue.consume(async (payload) => {
      await harness.execute.execute({
        runAttemptId: payload.runAttemptId,
        now: LATER,
      });
    });
    await harness.tick.execute(LATER, harness.ids);
    view = await harness.app.getWorkflowRun.execute(
      orchScope(),
      workflowRun.id,
    );
    expect(view.workflowRun.status).toBe("FAILED");
    expect(
      view.nodeRuns.find((node) => node.workflowNodeKey === "d"),
    ).toBeUndefined();
  });

  it("reuses child Runs and sequence 1 across concurrent reconciliation", async () => {
    const harness = await createHarness();
    const { agentA, agentB, agentC } = await seedAgents(harness);
    const version = await createVersion(
      harness,
      parallelDefinition(agentA, agentB, agentC),
    );
    const workflowRun = await harness.app.createWorkflowRun.execute(
      orchScope(),
      {
        workspaceId,
        workflowVersionId: version.id,
        input: { topic: "osva" },
      },
    );

    await Promise.all([
      harness.tick.execute(NOW, harness.ids),
      harness.tick.execute(NOW, harness.ids),
    ]);
    await Promise.all([
      harness.tick.execute(NOW, harness.ids),
      harness.tick.execute(NOW, harness.ids),
    ]);

    await runUntilTerminal(harness, workflowRun.id);
    const view = await harness.app.getWorkflowRun.execute(
      orchScope(),
      workflowRun.id,
    );
    expect(view.workflowRun.status).toBe("SUCCEEDED");
    for (const nodeRun of view.nodeRuns) {
      if (nodeRun.childRunId === undefined) {
        continue;
      }

      const attempts = await harness.runs.listRunAttempts(nodeRun.childRunId);
      expect(attempts.map((attempt) => attempt.sequence)).toEqual([1]);
    }

    const agentNodes = view.nodeRuns.filter((node) => node.childRunId);
    expect(agentNodes).toHaveLength(4);
    const listed = await harness.runs.listRuns({ workspaceId, limit: 20 });
    expect(listed.runs).toHaveLength(4);
  });

  it("continues from persisted PARALLEL fan-out after a new reconciler instance", async () => {
    const harness = await createHarness();
    const { agentA, agentB, agentC } = await seedAgents(harness);
    const version = await createVersion(
      harness,
      parallelDefinition(agentA, agentB, agentC),
    );
    const workflowRun = await harness.app.createWorkflowRun.execute(
      orchScope(),
      {
        workspaceId,
        workflowVersionId: version.id,
        input: { topic: "osva" },
      },
    );

    await runUntil(harness, async () => {
      const view = await harness.app.getWorkflowRun.execute(
        orchScope(),
        workflowRun.id,
      );
      const keys = view.nodeRuns.map((node) => node.workflowNodeKey);
      return keys.includes("b") && keys.includes("c");
    });

    harness.replaceTick(createTick(harness));
    await runUntilTerminal(harness, workflowRun.id);
    const view = await harness.app.getWorkflowRun.execute(
      orchScope(),
      workflowRun.id,
    );
    expect(view.workflowRun.status).toBe("SUCCEEDED");
  });

  it("continues when one parallel child has succeeded and the other is still pending", async () => {
    const harness = await createHarness();
    const { agentA, agentB, agentC } = await seedAgents(harness);
    const version = await createVersion(
      harness,
      parallelDefinition(agentA, agentB, agentC),
    );
    const workflowRun = await harness.app.createWorkflowRun.execute(
      orchScope(),
      {
        workspaceId,
        workflowVersionId: version.id,
        input: { topic: "osva" },
      },
    );

    await runUntilAfterTick(harness, async () => {
      const pending = harness.queue.pendingRunAttemptIds();
      const view = await harness.app.getWorkflowRun.execute(
        orchScope(),
        workflowRun.id,
      );
      const keys = view.nodeRuns.map((node) => node.workflowNodeKey);
      return keys.includes("b") && keys.includes("c") && pending.length >= 2;
    });

    const first = harness.queue.pendingRunAttemptIds()[0];
    if (first === undefined) {
      throw new Error("expected a pending child attempt");
    }
    await harness.execute.execute({ runAttemptId: first, now: LATER });
    await harness.tick.execute(LATER, harness.ids);

    harness.replaceTick(createTick(harness));
    await runUntilTerminal(harness, workflowRun.id);
    const view = await harness.app.getWorkflowRun.execute(
      orchScope(),
      workflowRun.id,
    );
    expect(view.workflowRun.status).toBe("SUCCEEDED");
    expect(byNodeKey(view.nodeRuns).join?.status).toBe("SUCCEEDED");
  });

  it("continues after BRANCH selection before inactive-path skip rows exist", async () => {
    const harness = await createHarness();
    const { agentA, agentB } = await seedAgents(harness);
    const version = await createVersion(
      harness,
      branchJoinDefinition(agentA, agentB),
    );
    const workflowRun = await harness.app.createWorkflowRun.execute(
      orchScope(),
      {
        workspaceId,
        workflowVersionId: version.id,
        input: { category: "sales" },
      },
    );

    await runUntil(harness, async () => {
      const view = await harness.app.getWorkflowRun.execute(
        orchScope(),
        workflowRun.id,
      );
      const route = view.nodeRuns.find(
        (node) => node.workflowNodeKey === "route",
      );
      return route?.status === "SUCCEEDED" && route.selectedTargetKey === "b";
    });

    harness.replaceTick(createTick(harness));
    await runUntilTerminal(harness, workflowRun.id);
    const view = await harness.app.getWorkflowRun.execute(
      orchScope(),
      workflowRun.id,
    );
    const byKey = byNodeKey(view.nodeRuns);
    expect(byKey.c?.status).toBe("SKIPPED");
    expect(view.workflowRun.status).toBe("SUCCEEDED");
  });

  it("resolves JOIN after a restart with both predecessors already terminal", async () => {
    const harness = await createHarness();
    const { agentA, agentB, agentC } = await seedAgents(harness);
    const version = await createVersion(
      harness,
      parallelDefinition(agentA, agentB, agentC),
    );
    const workflowRun = await harness.app.createWorkflowRun.execute(
      orchScope(),
      {
        workspaceId,
        workflowVersionId: version.id,
        input: { topic: "osva" },
      },
    );

    await runUntil(harness, async () => {
      const view = await harness.app.getWorkflowRun.execute(
        orchScope(),
        workflowRun.id,
      );
      const byKey = byNodeKey(view.nodeRuns);
      return byKey.b?.status === "SUCCEEDED" && byKey.c?.status === "SUCCEEDED";
    });

    harness.replaceTick(createTick(harness));
    await runUntilTerminal(harness, workflowRun.id);
    const view = await harness.app.getWorkflowRun.execute(
      orchScope(),
      workflowRun.id,
    );
    expect(view.workflowRun.status).toBe("SUCCEEDED");
    expect(byNodeKey(view.nodeRuns).d?.status).toBe("SUCCEEDED");
  });
});

function byNodeKey<T extends { readonly workflowNodeKey: string }>(
  nodeRuns: readonly T[],
): Record<string, T | undefined> {
  return Object.fromEntries(
    nodeRuns.map((node) => [node.workflowNodeKey, node]),
  );
}

function branchJoinDefinition(
  agentA: AgentVersionId,
  agentB: AgentVersionId,
): WorkflowDefinitionV2 {
  return {
    schemaVersion: "2",
    nodes: [
      { key: "classifier", type: "AGENT", agentVersionId: agentA },
      {
        key: "route",
        type: "BRANCH",
        selector: "/category",
        cases: [{ equals: "sales", to: "b" }],
        defaultTo: "c",
      },
      { key: "b", type: "AGENT", agentVersionId: agentA },
      { key: "c", type: "AGENT", agentVersionId: agentB },
      { key: "join", type: "JOIN" },
      { key: "d", type: "AGENT", agentVersionId: agentA },
    ],
    edges: [
      { from: "classifier", to: "route" },
      { from: "route", to: "b" },
      { from: "route", to: "c" },
      { from: "b", to: "join" },
      { from: "c", to: "join" },
      { from: "join", to: "d" },
    ],
  };
}

function skipJoinDefinition(
  agentA: AgentVersionId,
  agentB: AgentVersionId,
): WorkflowDefinitionV2 {
  return {
    schemaVersion: "2",
    nodes: [
      { key: "start", type: "AGENT", agentVersionId: agentA },
      {
        key: "route",
        type: "BRANCH",
        selector: "/category",
        cases: [{ equals: "keep", to: "keep" }],
        defaultTo: "left",
      },
      { key: "keep", type: "AGENT", agentVersionId: agentA },
      { key: "left", type: "AGENT", agentVersionId: agentB },
      { key: "skipFan", type: "PARALLEL" },
      { key: "x", type: "AGENT", agentVersionId: agentB },
      { key: "y", type: "AGENT", agentVersionId: agentB },
      { key: "skippedJoin", type: "JOIN" },
      { key: "merge", type: "JOIN" },
    ],
    edges: [
      { from: "start", to: "route" },
      { from: "route", to: "keep" },
      { from: "route", to: "left" },
      { from: "keep", to: "merge" },
      { from: "left", to: "skipFan" },
      { from: "skipFan", to: "x" },
      { from: "skipFan", to: "y" },
      { from: "x", to: "skippedJoin" },
      { from: "y", to: "skippedJoin" },
      { from: "skippedJoin", to: "merge" },
    ],
  };
}

function parallelDefinition(
  agentA: AgentVersionId,
  agentB: AgentVersionId,
  agentC: AgentVersionId,
): WorkflowDefinitionV2 {
  return {
    schemaVersion: "2",
    nodes: [
      { key: "a", type: "AGENT", agentVersionId: agentA },
      { key: "fanout", type: "PARALLEL" },
      { key: "b", type: "AGENT", agentVersionId: agentB },
      { key: "c", type: "AGENT", agentVersionId: agentC },
      { key: "join", type: "JOIN" },
      { key: "d", type: "AGENT", agentVersionId: agentA },
    ],
    edges: [
      { from: "a", to: "fanout" },
      { from: "fanout", to: "b" },
      { from: "fanout", to: "c" },
      { from: "b", to: "join" },
      { from: "c", to: "join" },
      { from: "join", to: "d" },
    ],
  };
}

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

async function createVersion(
  harness: TestHarness,
  definition: WorkflowDefinitionV2,
) {
  const workflow = await harness.app.createWorkflow.execute(orchScope(), {
    workspaceId,
    key: `wf-${String(harness.nextWorkflowKey())}`,
    name: "DAG",
  });
  return harness.app.appendWorkflowVersion.execute(orchScope(), {
    workflowId: workflow.id,
    definition,
  });
}

async function runUntilTerminal(
  harness: TestHarness,
  workflowRunId: WorkflowRunId,
): Promise<void> {
  await runUntil(harness, async () => {
    const view = await harness.app.getWorkflowRun.execute(
      orchScope(),
      workflowRunId,
    );
    return (
      view.workflowRun.status === "SUCCEEDED" ||
      view.workflowRun.status === "FAILED"
    );
  });
}

async function runUntil(
  harness: TestHarness,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await harness.tick.execute(LATER, harness.ids);
    await harness.queue.consume(async (payload) => {
      await harness.execute.execute({
        runAttemptId: payload.runAttemptId,
        now: LATER,
      });
    });
    if (await done()) {
      return;
    }
  }

  throw new Error("workflow did not reach the expected state");
}

async function runUntilAfterTick(
  harness: TestHarness,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await harness.tick.execute(LATER, harness.ids);
    if (await done()) {
      return;
    }
    await harness.queue.consume(async (payload) => {
      await harness.execute.execute({
        runAttemptId: payload.runAttemptId,
        now: LATER,
      });
    });
  }

  throw new Error("workflow did not reach the expected state");
}

interface TestHarness {
  readonly app: ReturnType<typeof createWorkflowApplication>;
  readonly agents: MemoryAgentRepository;
  readonly workspaces: MemoryWorkspaceRepository;
  readonly runs: MemoryRunRepository;
  readonly workflows: MemoryWorkflowRepository;
  readonly workflowRuns: MemoryWorkflowRunRepository;
  readonly workflowWaits: MemoryWorkflowWaitRepository;
  readonly approvalRequests: MemoryApprovalRequestRepository;
  readonly queue: MemoryJobQueue;
  tick: WorkflowOrchestratorTick;
  readonly execute: ExecuteRunAttempt;
  readonly createRun: CreateRun;
  readonly runsCreated: number;
  readonly ids: {
    createRunId(): RunId;
    createRunAttemptId(): RunAttemptId;
    createWorkflowNodeRunId(): WorkflowNodeRunId;
    createApprovalRequestId(): import("@osva/contracts").ApprovalRequestId;
  };
  nextWorkflowKey(): number;
  replaceTick(tick: WorkflowOrchestratorTick): void;
}

function createTick(harness: TestHarness): WorkflowOrchestratorTick {
  return new WorkflowOrchestratorTick({
    workflowRuns: harness.workflowRuns,
    reconcile: new ReconcileWorkflowRun({
      workflows: harness.workflows,
      workflowRuns: harness.workflowRuns,
      workflowWaits: harness.workflowWaits,
      approvalRequests: harness.approvalRequests,
      agents: harness.agents,
      runs: harness.runs,
      createRun: harness.createRun,
      queue: harness.queue,
    }),
  });
}

async function createHarness(options?: {
  readonly failAgentVersionIds?: Set<string>;
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
  const workflowWaits = new MemoryWorkflowWaitRepository();
  const approvalRequests = new MemoryApprovalRequestRepository();
  const queue = new MemoryJobQueue();
  let runCounter = 0;
  let attemptCounter = 0;
  let nodeCounter = 0;
  let approvalCounter = 0;
  let workflowCounter = 0;
  let workflowKey = 0;
  const createRun = new CreateRun({ runs, agents, queue });
  const execute = new ExecuteRunAttempt({
    runs,
    agents,
    runtime: new FakeRuntimeAdapter(async (request) => {
      if (options?.failAgentVersionIds?.has(request.agentVersionId)) {
        return {
          status: "failed",
          error: { code: "RUNTIME_FAILED", message: "node failed" },
        };
      }

      return {
        status: "succeeded",
        output:
          request.input !== null &&
          typeof request.input === "object" &&
          !Array.isArray(request.input)
            ? { ...request.input, from: request.agentVersionId }
            : { from: request.agentVersionId, received: request.input },
      };
    }),
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

  const harness: TestHarness = {
    app,
    agents,
    workspaces,
    runs: innerRuns,
    workflows,
    workflowRuns,
    workflowWaits,
    approvalRequests,
    queue,
    tick: undefined as unknown as WorkflowOrchestratorTick,
    execute,
    createRun,
    get runsCreated() {
      return runsCreated;
    },
    nextWorkflowKey() {
      workflowKey += 1;
      return workflowKey;
    },
    replaceTick(next) {
      harness.tick = next;
    },
    ids: {
      createRunId: () => {
        runCounter += 1;
        return `run-${String(runCounter)}` as RunId;
      },
      createRunAttemptId: () => {
        attemptCounter += 1;
        return `attempt-${String(attemptCounter)}` as RunAttemptId;
      },
      createWorkflowNodeRunId: () => {
        nodeCounter += 1;
        return `node-run-${String(nodeCounter)}` as WorkflowNodeRunId;
      },
      createApprovalRequestId: () => {
        approvalCounter += 1;
        return `approval-${String(approvalCounter)}` as import("@osva/contracts").ApprovalRequestId;
      },
    },
  };
  harness.tick = createTick(harness);
  return harness;
}
