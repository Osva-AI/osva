import type {
  AgentVersionId,
  ApprovalRequestId,
  RunAttemptId,
  RunId,
  WorkflowDefinitionV2,
  WorkflowNodeRunId,
  WorkflowRunId,
} from "@osva/contracts";
import {
  FakeRuntimeAdapter,
  MemoryAgentRepository,
  MemoryApprovalRequestRepository,
  MemoryJobQueue,
  MemoryRunRepository,
  MemoryWorkflowRepository,
  MemoryWorkflowRunRepository,
  MemoryWorkflowWaitRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import {
  APPROVAL_REJECTED_ERROR_CODE,
  LifecycleConflictError,
  createWorkflowApplication,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { CreateRun } from "../src/create-run.js";
import { ExecuteRunAttempt } from "../src/execute-run-attempt.js";
import { ReconcileWorkflowRun } from "../src/reconcile-workflow-run.js";
import { WorkflowOrchestratorTick } from "../src/workflow-orchestrator-tick.js";
import { LATER, seedAgentGraph, workspaceId } from "./fixtures.js";
import { wrapRunRepository } from "./fixtures.js";

describe("approval and multi-agent workflow orchestration", () => {
  it("hands off between three AgentVersions through a durable APPROVAL gate", async () => {
    const harness = await createHarness();
    const agents = await seedAgents(harness);
    const version = await createVersion(
      harness,
      sequentialApprovalDefinition(
        agents.research,
        agents.analysis,
        agents.publish,
      ),
    );
    const workflowRun = await harness.app.createWorkflowRun.execute({
      workspaceId,
      workflowVersionId: version.id,
      input: { campaign: "launch" },
    });

    await waitUntilWaiting(harness, workflowRun.id);
    const waiting = await harness.app.getWorkflowRun.execute(workflowRun.id);
    const byKey = byNodeKey(waiting.nodeRuns);
    expect(waiting.workflowRun.status).toBe("WAITING");
    expect(byKey.research?.status).toBe("SUCCEEDED");
    expect(byKey.research?.childRunId).toBeTruthy();
    expect(byKey.analysis?.status).toBe("SUCCEEDED");
    expect(byKey.analysis?.childRunId).toBeTruthy();
    expect(byKey.review?.status).toBe("WAITING");
    expect(byKey.review?.childRunId).toBeUndefined();
    expect(byKey.publish).toBeUndefined();
    expect(waiting.approvalRequests).toHaveLength(1);
    expect(waiting.approvalRequests[0]?.status).toBe("PENDING");
    expect(waiting.approvalRequests[0]?.workflowNodeRunId).toBe(
      byKey.review?.id,
    );

    const researchRun = await harness.runs.findRunById(
      byKey.research!.childRunId!,
    );
    const analysisRun = await harness.runs.findRunById(
      byKey.analysis!.childRunId!,
    );
    expect(researchRun?.effectiveBindings.agentVersionId).toBe(agents.research);
    expect(analysisRun?.effectiveBindings.agentVersionId).toBe(agents.analysis);

    const decided = await harness.app.decideApprovalRequest.execute({
      workspaceId,
      approvalRequestId: waiting.approvalRequests[0]!.id,
      decision: "APPROVED",
      comment: "Looks good.",
    });
    expect(decided.status).toBe("APPROVED");
    const afterDecision = await harness.app.getWorkflowRun.execute(
      workflowRun.id,
    );
    expect(afterDecision.workflowRun.status).toBe("WAITING");
    expect(
      afterDecision.nodeRuns.find((node) => node.workflowNodeKey === "review")
        ?.status,
    ).toBe("WAITING");

    await runUntilTerminal(harness, workflowRun.id);
    const succeeded = await harness.app.getWorkflowRun.execute(workflowRun.id);
    const succeededByKey = byNodeKey(succeeded.nodeRuns);
    expect(succeeded.workflowRun.status).toBe("SUCCEEDED");
    expect(succeededByKey.review?.status).toBe("SUCCEEDED");
    expect(succeededByKey.review?.output).toEqual(succeededByKey.review?.input);
    expect(succeededByKey.publish?.status).toBe("SUCCEEDED");
    expect(succeededByKey.publish?.childRunId).toBeTruthy();
    const publishRun = await harness.runs.findRunById(
      succeededByKey.publish!.childRunId!,
    );
    expect(publishRun?.effectiveBindings.agentVersionId).toBe(agents.publish);
  });

  it("fails the workflow on rejection without starting the successor agent", async () => {
    const harness = await createHarness();
    const agents = await seedAgents(harness);
    const version = await createVersion(
      harness,
      sequentialApprovalDefinition(
        agents.research,
        agents.analysis,
        agents.publish,
      ),
    );
    const workflowRun = await harness.app.createWorkflowRun.execute({
      workspaceId,
      workflowVersionId: version.id,
      input: { campaign: "launch" },
    });

    await waitUntilWaiting(harness, workflowRun.id);
    const waiting = await harness.app.getWorkflowRun.execute(workflowRun.id);
    await harness.app.decideApprovalRequest.execute({
      workspaceId,
      approvalRequestId: waiting.approvalRequests[0]!.id,
      decision: "REJECTED",
      comment: "Budget exceeds the agreed threshold.",
    });

    await runUntilTerminal(harness, workflowRun.id);
    const failed = await harness.app.getWorkflowRun.execute(workflowRun.id);
    const byKey = byNodeKey(failed.nodeRuns);
    expect(failed.workflowRun.status).toBe("FAILED");
    expect(failed.workflowRun.error?.code).toBe(APPROVAL_REJECTED_ERROR_CODE);
    expect(byKey.review?.status).toBe("FAILED");
    expect(byKey.review?.error?.code).toBe(APPROVAL_REJECTED_ERROR_CODE);
    expect(byKey.publish).toBeUndefined();
    expect(failed.approvalRequests[0]?.status).toBe("REJECTED");
  });

  it("keeps WorkflowRun RUNNING while a parallel agent is still executing", async () => {
    const harness = await createHarness();
    const agents = await seedAgents(harness);
    const version = await createVersion(
      harness,
      parallelApprovalDefinition(agents.research, agents.analysis),
    );
    const workflowRun = await harness.app.createWorkflowRun.execute({
      workspaceId,
      workflowVersionId: version.id,
      input: { campaign: "launch" },
    });

    await waitUntil(
      harness,
      async () => {
        const view = await harness.app.getWorkflowRun.execute(workflowRun.id);
        const byKey = byNodeKey(view.nodeRuns);
        return (
          byKey.review?.status === "WAITING" &&
          byKey.agent?.status === "RUNNING"
        );
      },
      false,
    );
    const running = await harness.app.getWorkflowRun.execute(workflowRun.id);
    expect(running.workflowRun.status).toBe("RUNNING");
    expect(running.approvalRequests).toHaveLength(1);
    expect(running.approvalRequests[0]?.status).toBe("PENDING");

    await waitUntilWaiting(harness, workflowRun.id);
    const waiting = await harness.app.getWorkflowRun.execute(workflowRun.id);
    expect(waiting.workflowRun.status).toBe("WAITING");
    expect(byNodeKey(waiting.nodeRuns).agent?.status).toBe("SUCCEEDED");
  });

  it("requires both parallel approvals before JOIN continues", async () => {
    const harness = await createHarness();
    const agents = await seedAgents(harness);
    const version = await createVersion(
      harness,
      dualApprovalDefinition(agents.publish),
    );
    const workflowRun = await harness.app.createWorkflowRun.execute({
      workspaceId,
      workflowVersionId: version.id,
      input: { campaign: "launch" },
    });

    await waitUntilWaiting(harness, workflowRun.id);
    const waiting = await harness.app.getWorkflowRun.execute(workflowRun.id);
    expect(waiting.approvalRequests).toHaveLength(2);
    const finance = waiting.approvalRequests.find(
      (request) =>
        waiting.nodeRuns.find((node) => node.id === request.workflowNodeRunId)
          ?.workflowNodeKey === "finance",
    );
    const legal = waiting.approvalRequests.find(
      (request) =>
        waiting.nodeRuns.find((node) => node.id === request.workflowNodeRunId)
          ?.workflowNodeKey === "legal",
    );
    expect(finance).toBeDefined();
    expect(legal).toBeDefined();

    await harness.app.decideApprovalRequest.execute({
      workspaceId,
      approvalRequestId: finance!.id,
      decision: "APPROVED",
    });
    await waitUntil(harness, async () => {
      const view = await harness.app.getWorkflowRun.execute(workflowRun.id);
      return (
        byNodeKey(view.nodeRuns).finance?.status === "SUCCEEDED" &&
        view.workflowRun.status === "WAITING"
      );
    });
    const oneApproved = await harness.app.getWorkflowRun.execute(
      workflowRun.id,
    );
    expect(byNodeKey(oneApproved.nodeRuns).join).toBeUndefined();
    expect(byNodeKey(oneApproved.nodeRuns).publish).toBeUndefined();

    await harness.app.decideApprovalRequest.execute({
      workspaceId,
      approvalRequestId: legal!.id,
      decision: "APPROVED",
    });
    await runUntilTerminal(harness, workflowRun.id);
    const succeeded = await harness.app.getWorkflowRun.execute(workflowRun.id);
    expect(succeeded.workflowRun.status).toBe("SUCCEEDED");
    expect(byNodeKey(succeeded.nodeRuns).join?.status).toBe("SUCCEEDED");
    expect(byNodeKey(succeeded.nodeRuns).publish?.status).toBe("SUCCEEDED");
  });

  it("fails the workflow when one of two parallel approvals is rejected", async () => {
    const harness = await createHarness();
    const agents = await seedAgents(harness);
    const version = await createVersion(
      harness,
      dualApprovalDefinition(agents.publish),
    );
    const workflowRun = await harness.app.createWorkflowRun.execute({
      workspaceId,
      workflowVersionId: version.id,
      input: { campaign: "launch" },
    });

    await waitUntilWaiting(harness, workflowRun.id);
    const waiting = await harness.app.getWorkflowRun.execute(workflowRun.id);
    await harness.app.decideApprovalRequest.execute({
      workspaceId,
      approvalRequestId: waiting.approvalRequests[0]!.id,
      decision: "REJECTED",
    });
    await runUntilTerminal(harness, workflowRun.id);
    const failed = await harness.app.getWorkflowRun.execute(workflowRun.id);
    expect(failed.workflowRun.status).toBe("FAILED");
    expect(failed.workflowRun.error?.code).toBe(APPROVAL_REJECTED_ERROR_CODE);
    expect(byNodeKey(failed.nodeRuns).publish).toBeUndefined();
  });

  it("recovers waiting, approved, and rejected approval state across restart", async () => {
    const harness = await createHarness();
    const agents = await seedAgents(harness);
    const version = await createVersion(
      harness,
      sequentialApprovalDefinition(
        agents.research,
        agents.analysis,
        agents.publish,
      ),
    );
    const workflowRun = await harness.app.createWorkflowRun.execute({
      workspaceId,
      workflowVersionId: version.id,
      input: { campaign: "launch" },
    });

    await waitUntilWaiting(harness, workflowRun.id);
    harness.replaceTick(createTick(harness));
    await harness.tick.execute(LATER, harness.ids);
    const stillWaiting = await harness.app.getWorkflowRun.execute(
      workflowRun.id,
    );
    expect(stillWaiting.workflowRun.status).toBe("WAITING");
    expect(stillWaiting.approvalRequests).toHaveLength(1);

    await harness.app.decideApprovalRequest.execute({
      workspaceId,
      approvalRequestId: stillWaiting.approvalRequests[0]!.id,
      decision: "APPROVED",
    });
    harness.replaceTick(createTick(harness));
    await runUntilTerminal(harness, workflowRun.id);
    expect(
      (await harness.app.getWorkflowRun.execute(workflowRun.id)).workflowRun
        .status,
    ).toBe("SUCCEEDED");

    const rejectedHarness = await createHarness();
    const rejectedAgents = await seedAgents(rejectedHarness);
    const rejectedVersion = await createVersion(
      rejectedHarness,
      sequentialApprovalDefinition(
        rejectedAgents.research,
        rejectedAgents.analysis,
        rejectedAgents.publish,
      ),
    );
    const rejectedRun = await rejectedHarness.app.createWorkflowRun.execute({
      workspaceId,
      workflowVersionId: rejectedVersion.id,
      input: { campaign: "launch" },
    });
    await waitUntilWaiting(rejectedHarness, rejectedRun.id);
    const pending = await rejectedHarness.app.getWorkflowRun.execute(
      rejectedRun.id,
    );
    await rejectedHarness.app.decideApprovalRequest.execute({
      workspaceId,
      approvalRequestId: pending.approvalRequests[0]!.id,
      decision: "REJECTED",
    });
    rejectedHarness.replaceTick(createTick(rejectedHarness));
    await runUntilTerminal(rejectedHarness, rejectedRun.id);
    expect(
      (await rejectedHarness.app.getWorkflowRun.execute(rejectedRun.id))
        .workflowRun.status,
    ).toBe("FAILED");
  });

  it("materializes one ApprovalRequest under concurrent reconcilers", async () => {
    const harness = await createHarness();
    const agents = await seedAgents(harness);
    const version = await createVersion(
      harness,
      sequentialApprovalDefinition(
        agents.research,
        agents.analysis,
        agents.publish,
      ),
    );
    const workflowRun = await harness.app.createWorkflowRun.execute({
      workspaceId,
      workflowVersionId: version.id,
      input: { campaign: "launch" },
    });
    await waitUntilWaiting(harness, workflowRun.id);
    const first = await harness.app.getWorkflowRun.execute(workflowRun.id);

    await Promise.all([
      harness.tick.execute(LATER, harness.ids),
      harness.tick.execute(LATER, harness.ids),
    ]);
    const after = await harness.app.getWorkflowRun.execute(workflowRun.id);
    expect(after.approvalRequests).toHaveLength(1);
    expect(after.approvalRequests[0]?.id).toBe(first.approvalRequests[0]?.id);
  });

  it("treats identical concurrent decisions as idempotent and rejects conflicts", async () => {
    const harness = await createHarness();
    const agents = await seedAgents(harness);
    const version = await createVersion(
      harness,
      sequentialApprovalDefinition(
        agents.research,
        agents.analysis,
        agents.publish,
      ),
    );
    const workflowRun = await harness.app.createWorkflowRun.execute({
      workspaceId,
      workflowVersionId: version.id,
      input: { campaign: "launch" },
    });
    await waitUntilWaiting(harness, workflowRun.id);
    const waiting = await harness.app.getWorkflowRun.execute(workflowRun.id);
    const id = waiting.approvalRequests[0]!.id;

    const identical = await Promise.all([
      harness.app.decideApprovalRequest.execute({
        workspaceId,
        approvalRequestId: id,
        decision: "APPROVED",
        comment: "first",
      }),
      harness.app.decideApprovalRequest.execute({
        workspaceId,
        approvalRequestId: id,
        decision: "APPROVED",
        comment: "second",
      }),
    ]);
    expect(identical[0]?.status).toBe("APPROVED");
    expect(identical[1]?.status).toBe("APPROVED");
    expect(identical[0]?.decisionComment).toBe(identical[1]?.decisionComment);
    expect(identical[0]?.decidedAt?.getTime()).toBe(
      identical[1]?.decidedAt?.getTime(),
    );

    await expect(
      harness.app.decideApprovalRequest.execute({
        workspaceId,
        approvalRequestId: id,
        decision: "REJECTED",
      }),
    ).rejects.toBeInstanceOf(LifecycleConflictError);
  });

  it("skips an inactive APPROVAL path without creating an ApprovalRequest", async () => {
    const harness = await createHarness();
    const agents = await seedAgents(harness);
    const version = await createVersion(
      harness,
      branchAroundApprovalDefinition(agents.research, agents.publish),
    );
    const workflowRun = await harness.app.createWorkflowRun.execute({
      workspaceId,
      workflowVersionId: version.id,
      input: { category: "publish" },
    });
    await runUntilTerminal(harness, workflowRun.id);
    const view = await harness.app.getWorkflowRun.execute(workflowRun.id);
    const byKey = byNodeKey(view.nodeRuns);
    expect(view.workflowRun.status).toBe("SUCCEEDED");
    expect(byKey.review?.status).toBe("SKIPPED");
    expect(byKey.publish?.status).toBe("SUCCEEDED");
    expect(view.approvalRequests).toHaveLength(0);
  });
});

function sequentialApprovalDefinition(
  research: AgentVersionId,
  analysis: AgentVersionId,
  publish: AgentVersionId,
): WorkflowDefinitionV2 {
  return {
    schemaVersion: "2",
    nodes: [
      { key: "research", type: "AGENT", agentVersionId: research },
      { key: "analysis", type: "AGENT", agentVersionId: analysis },
      {
        key: "review",
        type: "APPROVAL",
        title: "Approve campaign launch",
      },
      { key: "publish", type: "AGENT", agentVersionId: publish },
    ],
    edges: [
      { from: "research", to: "analysis" },
      { from: "analysis", to: "review" },
      { from: "review", to: "publish" },
    ],
  };
}

function parallelApprovalDefinition(
  agent: AgentVersionId,
  unused: AgentVersionId,
): WorkflowDefinitionV2 {
  return {
    schemaVersion: "2",
    nodes: [
      { key: "fanout", type: "PARALLEL" },
      {
        key: "review",
        type: "APPROVAL",
        title: "Approve campaign",
      },
      { key: "agent", type: "AGENT", agentVersionId: agent },
      { key: "join", type: "JOIN" },
      { key: "done", type: "AGENT", agentVersionId: unused },
    ],
    edges: [
      { from: "fanout", to: "review" },
      { from: "fanout", to: "agent" },
      { from: "review", to: "join" },
      { from: "agent", to: "join" },
      { from: "join", to: "done" },
    ],
  };
}

function dualApprovalDefinition(publish: AgentVersionId): WorkflowDefinitionV2 {
  return {
    schemaVersion: "2",
    nodes: [
      { key: "fanout", type: "PARALLEL" },
      { key: "finance", type: "APPROVAL", title: "Finance approval" },
      { key: "legal", type: "APPROVAL", title: "Legal approval" },
      { key: "join", type: "JOIN" },
      { key: "publish", type: "AGENT", agentVersionId: publish },
    ],
    edges: [
      { from: "fanout", to: "finance" },
      { from: "fanout", to: "legal" },
      { from: "finance", to: "join" },
      { from: "legal", to: "join" },
      { from: "join", to: "publish" },
    ],
  };
}

function branchAroundApprovalDefinition(
  skippedAgent: AgentVersionId,
  selectedAgent: AgentVersionId,
): WorkflowDefinitionV2 {
  return {
    schemaVersion: "2",
    nodes: [
      {
        key: "route",
        type: "BRANCH",
        selector: "/category",
        cases: [{ equals: "review", to: "review" }],
        defaultTo: "publish",
      },
      { key: "review", type: "APPROVAL", title: "Review" },
      { key: "skipped", type: "AGENT", agentVersionId: skippedAgent },
      { key: "publish", type: "AGENT", agentVersionId: selectedAgent },
      { key: "join", type: "JOIN" },
    ],
    edges: [
      { from: "route", to: "review" },
      { from: "route", to: "publish" },
      { from: "review", to: "skipped" },
      { from: "skipped", to: "join" },
      { from: "publish", to: "join" },
    ],
  };
}

function byNodeKey<T extends { readonly workflowNodeKey: string }>(
  nodeRuns: readonly T[],
): Record<string, T | undefined> {
  return Object.fromEntries(
    nodeRuns.map((node) => [node.workflowNodeKey, node]),
  );
}

async function seedAgents(harness: TestHarness) {
  await seedAgentGraph(harness.workspaces, harness.agents, {
    agentId: "agent-research" as never,
    agentVersionId: "agent-version-research" as AgentVersionId,
    key: "research-agent",
  });
  await seedAgentGraph(harness.workspaces, harness.agents, {
    workspaceId,
    agentId: "agent-analysis" as never,
    agentVersionId: "agent-version-analysis" as AgentVersionId,
    key: "analysis-agent",
  });
  await seedAgentGraph(harness.workspaces, harness.agents, {
    workspaceId,
    agentId: "agent-publish" as never,
    agentVersionId: "agent-version-publish" as AgentVersionId,
    key: "publish-agent",
  });
  return {
    research: "agent-version-research" as AgentVersionId,
    analysis: "agent-version-analysis" as AgentVersionId,
    publish: "agent-version-publish" as AgentVersionId,
  };
}

async function createVersion(
  harness: TestHarness,
  definition: WorkflowDefinitionV2,
) {
  const workflow = await harness.app.createWorkflow.execute({
    workspaceId,
    key: `wf-${String(harness.nextWorkflowKey())}`,
    name: "Approval",
  });
  return harness.app.appendWorkflowVersion.execute({
    workflowId: workflow.id,
    definition,
  });
}

async function waitUntilWaiting(
  harness: TestHarness,
  workflowRunId: WorkflowRunId,
): Promise<void> {
  await waitUntil(harness, async () => {
    const view = await harness.app.getWorkflowRun.execute(workflowRunId);
    return view.workflowRun.status === "WAITING";
  });
}

async function runUntilTerminal(
  harness: TestHarness,
  workflowRunId: WorkflowRunId,
): Promise<void> {
  await waitUntil(harness, async () => {
    const view = await harness.app.getWorkflowRun.execute(workflowRunId);
    return (
      view.workflowRun.status === "SUCCEEDED" ||
      view.workflowRun.status === "FAILED"
    );
  });
}

async function waitUntil(
  harness: TestHarness,
  done: () => Promise<boolean>,
  consumeQueue = true,
): Promise<void> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await harness.tick.execute(LATER, harness.ids);
    if (consumeQueue) {
      await harness.queue.consume(async (payload) => {
        await harness.execute.execute({
          runAttemptId: payload.runAttemptId,
          now: LATER,
        });
      });
    }
    if (await done()) {
      return;
    }
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
  readonly ids: {
    createRunId(): RunId;
    createRunAttemptId(): RunAttemptId;
    createWorkflowNodeRunId(): WorkflowNodeRunId;
    createApprovalRequestId(): ApprovalRequestId;
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

async function createHarness(): Promise<TestHarness> {
  const workspaces = new MemoryWorkspaceRepository();
  const agents = new MemoryAgentRepository();
  const innerRuns = new MemoryRunRepository();
  const runs = wrapRunRepository(innerRuns, {});
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
    runtime: new FakeRuntimeAdapter(async (request) => ({
      status: "succeeded",
      output:
        request.input !== null &&
        typeof request.input === "object" &&
        !Array.isArray(request.input)
          ? { ...request.input, from: request.agentVersionId }
          : { from: request.agentVersionId, received: request.input },
    })),
  });
  const app = createWorkflowApplication({
    workflows,
    workflowRuns,
    approvalRequests,
    agents,
    workspaces,
    clock: { now: () => LATER },
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
        return `approval-${String(approvalCounter)}` as ApprovalRequestId;
      },
    },
  };
  harness.tick = createTick(harness);
  return harness;
}
