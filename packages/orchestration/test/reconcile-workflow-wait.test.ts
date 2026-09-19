import type {
  WorkflowDefinitionV3,
  WorkflowDefinitionWaitConfigurationV3,
  WorkflowId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkflowVersionId,
} from "@osva/contracts";
import {
  MemoryWorkflowRepository,
  MemoryWorkflowRunRepository,
  MemoryWorkflowWaitRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import {
  DomainInvariantError,
  WORKFLOW_EVENT_TIMEOUT_ERROR_CODE,
  Workspace,
  Workflow,
  WorkflowNodeRun,
  WorkflowRun,
  WorkflowVersion,
  WorkflowWait,
  armWorkflowWait,
  buildWorkflowGraph,
  isNodeReady,
  nodeRunsByKey,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { WorkflowWaitReconciliation } from "../src/workflow-wait-reconciliation.js";
import { agentVersionId, workspaceId } from "./fixtures.js";

const T0 = new Date("2026-01-01T10:00:00.000Z");
const T3 = new Date("2026-01-01T10:03:00.000Z");
const RUN_CREATED = new Date("2026-01-01T09:00:00.000Z");

describe("WorkflowWaitReconciliation", () => {
  it("materializes a ready WAIT node, marks it WAITING, and arms a DURATION wait from startedAt", async () => {
    const harness = await seedHarness(
      agentThenWait({ kind: "DURATION", durationMs: 5 * 60_000 }),
    );
    await harness.workflowRuns.saveWorkflowNodeRun(
      succeededAgentNode(harness, { output: { orderId: "ord-9" } }),
    );

    await harness.reconciliation.reconcile({
      workflowRun: harness.workflowRun,
      now: T3,
      ids: harness.ids,
    });

    const delay =
      await harness.workflowRuns.findWorkflowNodeRunByWorkflowRunAndKey(
        harness.workflowRun.id,
        "delay",
      );
    expect(delay?.status).toBe("WAITING");
    expect(delay?.startedAt?.toISOString()).toBe(T3.toISOString());

    const wait =
      await harness.workflowWaits.findWorkflowWaitByWorkflowNodeRunId(
        delay!.id,
      );
    expect(wait?.armedAt.toISOString()).toBe(T3.toISOString());
    expect(wait?.wakeAt?.toISOString()).toBe("2026-01-01T10:08:00.000Z");
  });

  it("recovers a WAITING node without a wait using the original startedAt", async () => {
    const harness = await seedHarness(
      agentThenWait({ kind: "DURATION", durationMs: 5 * 60_000 }),
    );
    const agent = succeededAgentNode(harness, {});
    await harness.workflowRuns.saveWorkflowNodeRun(agent);
    const waiting = WorkflowNodeRun.rehydrate({
      id: "node-delay" as WorkflowNodeRunId,
      workspaceId,
      workflowRunId: harness.workflowRun.id,
      workflowNodeKey: "delay",
      sequence: 2,
      status: "WAITING",
      input: { orderId: "ord-9" },
      startedAt: T0,
      createdAt: T0,
      updatedAt: T0,
    });
    await harness.workflowRuns.saveWorkflowNodeRun(waiting);

    await harness.reconciliation.reconcile({
      workflowRun: harness.workflowRun,
      now: T3,
      ids: harness.ids,
    });

    const wait =
      await harness.workflowWaits.findWorkflowWaitByWorkflowNodeRunId(
        waiting.id,
      );
    expect(wait?.armedAt.toISOString()).toBe(T0.toISOString());
    expect(wait?.wakeAt?.toISOString()).toBe("2026-01-01T10:05:00.000Z");
  });

  it("freezes EVENT expiresAt and INPUT_POINTER correlation from persisted node input", async () => {
    const harness = await seedHarness(
      agentThenWait({
        kind: "EVENT",
        source: "billing",
        eventType: "invoice.paid",
        correlation: { kind: "INPUT_POINTER", pointer: "/orderId" },
        timeoutMs: 60_000,
      }),
    );
    await harness.workflowRuns.saveWorkflowNodeRun(
      succeededAgentNode(harness, { output: { orderId: "from-agent" } }),
    );

    await harness.reconciliation.reconcile({
      workflowRun: harness.workflowRun,
      now: T3,
      ids: harness.ids,
    });

    const delay =
      await harness.workflowRuns.findWorkflowNodeRunByWorkflowRunAndKey(
        harness.workflowRun.id,
        "delay",
      );
    const wait =
      await harness.workflowWaits.findWorkflowWaitByWorkflowNodeRunId(
        delay!.id,
      );
    expect(wait?.correlationKey).toBe("from-agent");
    expect(wait?.expiresAt?.toISOString()).toBe("2026-01-01T10:04:00.000Z");
  });

  it("rejects conflicting persisted wait arms", async () => {
    const harness = await seedHarness(
      agentThenWait({ kind: "DURATION", durationMs: 5 * 60_000 }),
    );
    const agent = succeededAgentNode(harness, {});
    await harness.workflowRuns.saveWorkflowNodeRun(agent);
    const waiting = WorkflowNodeRun.rehydrate({
      id: "node-delay" as WorkflowNodeRunId,
      workspaceId,
      workflowRunId: harness.workflowRun.id,
      workflowNodeKey: "delay",
      sequence: 2,
      status: "WAITING",
      input: {},
      startedAt: T0,
      createdAt: T0,
      updatedAt: T0,
    });
    await harness.workflowRuns.saveWorkflowNodeRun(waiting);
    await harness.workflowWaits.saveWorkflowWait(
      armWorkflowWait({
        workspaceId,
        workflowRunId: harness.workflowRun.id,
        workflowNodeRunId: waiting.id,
        workflowRunCreatedAt: RUN_CREATED,
        wait: { kind: "DURATION", durationMs: 1 },
        nodeInput: {},
        armedAt: T0,
      }),
    );

    await expect(
      harness.reconciliation.reconcile({
        workflowRun: harness.workflowRun,
        now: T3,
        ids: harness.ids,
      }),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });

  it("does not arm waits for terminal workflow runs or terminal node runs", async () => {
    const harness = await seedHarness(
      waitOnly({ kind: "DURATION", durationMs: 1_000 }),
    );
    const terminalRun = harness.workflowRun.markSucceeded(
      T3,
      harness.workflowRun.input,
    );
    await harness.workflowRuns.transitionWorkflowRun("RUNNING", terminalRun);

    await harness.reconciliation.reconcile({
      workflowRun: terminalRun,
      now: T3,
      ids: harness.ids,
    });
    expect(
      await harness.workflowWaits.listWorkflowWaitsByWorkflowRunId(
        harness.workflowRun.id,
      ),
    ).toHaveLength(0);
  });

  it("progresses TIMER and EVENT resolutions with pass-through output", async () => {
    const harness = await seedHarness(
      waitOnly({ kind: "DURATION", durationMs: 1 }),
    );
    const waiting = WorkflowNodeRun.rehydrate({
      id: "node-delay" as WorkflowNodeRunId,
      workspaceId,
      workflowRunId: harness.workflowRun.id,
      workflowNodeKey: "delay",
      sequence: 1,
      status: "WAITING",
      input: { keep: true },
      startedAt: T0,
      createdAt: T0,
      updatedAt: T0,
    });
    await harness.workflowRuns.saveWorkflowNodeRun(waiting);
    const armed = armWorkflowWait({
      workspaceId,
      workflowRunId: harness.workflowRun.id,
      workflowNodeRunId: waiting.id,
      workflowRunCreatedAt: RUN_CREATED,
      wait: { kind: "DURATION", durationMs: 1 },
      nodeInput: waiting.input,
      armedAt: T0,
    });
    await harness.workflowWaits.saveWorkflowWait(armed.resolveTimer(T3));

    await harness.reconciliation.reconcile({
      workflowRun: harness.workflowRun,
      now: T3,
      ids: harness.ids,
    });

    const progressed = await harness.workflowRuns.findWorkflowNodeRunById(
      waiting.id,
    );
    expect(progressed?.status).toBe("SUCCEEDED");
    expect(progressed?.output).toEqual({ keep: true });
  });

  it("fails WAITING nodes on TIMEOUT resolution with WORKFLOW_EVENT_TIMEOUT", async () => {
    const harness = await seedHarness(
      waitOnly({
        kind: "EVENT",
        source: "billing",
        eventType: "invoice.paid",
        correlation: { kind: "LITERAL", value: "x" },
        timeoutMs: 1,
      }),
    );
    const waiting = WorkflowNodeRun.rehydrate({
      id: "node-delay" as WorkflowNodeRunId,
      workspaceId,
      workflowRunId: harness.workflowRun.id,
      workflowNodeKey: "delay",
      sequence: 1,
      status: "WAITING",
      input: {},
      startedAt: T0,
      createdAt: T0,
      updatedAt: T0,
    });
    await harness.workflowRuns.saveWorkflowNodeRun(waiting);
    const armed = armWorkflowWait({
      workspaceId,
      workflowRunId: harness.workflowRun.id,
      workflowNodeRunId: waiting.id,
      workflowRunCreatedAt: RUN_CREATED,
      wait: {
        kind: "EVENT",
        source: "billing",
        eventType: "invoice.paid",
        correlation: { kind: "LITERAL", value: "x" },
        timeoutMs: 1,
      },
      nodeInput: {},
      armedAt: T0,
    });
    await harness.workflowWaits.saveWorkflowWait(armed.resolveTimeout(T3));

    await harness.reconciliation.reconcile({
      workflowRun: harness.workflowRun,
      now: T3,
      ids: harness.ids,
    });

    const failed = await harness.workflowRuns.findWorkflowNodeRunById(
      waiting.id,
    );
    expect(failed?.status).toBe("FAILED");
    expect(failed?.error?.code).toBe(WORKFLOW_EVENT_TIMEOUT_ERROR_CODE);
  });

  it("leaves CANCELLED waits without progressing the node", async () => {
    const harness = await seedHarness(
      waitOnly({ kind: "DURATION", durationMs: 1 }),
    );
    const waiting = WorkflowNodeRun.rehydrate({
      id: "node-delay" as WorkflowNodeRunId,
      workspaceId,
      workflowRunId: harness.workflowRun.id,
      workflowNodeKey: "delay",
      sequence: 1,
      status: "WAITING",
      input: {},
      startedAt: T0,
      createdAt: T0,
      updatedAt: T0,
    });
    await harness.workflowRuns.saveWorkflowNodeRun(waiting);
    const armed = armWorkflowWait({
      workspaceId,
      workflowRunId: harness.workflowRun.id,
      workflowNodeRunId: waiting.id,
      workflowRunCreatedAt: RUN_CREATED,
      wait: { kind: "DURATION", durationMs: 1 },
      nodeInput: {},
      armedAt: T0,
    });
    await harness.workflowWaits.saveWorkflowWait(
      WorkflowWait.rehydrate({
        workspaceId: armed.workspaceId,
        workflowRunId: armed.workflowRunId,
        workflowNodeRunId: armed.workflowNodeRunId,
        kind: armed.kind,
        armedAt: armed.armedAt,
        wakeAt: armed.wakeAt,
        resolvedAt: T3,
        resolution: "CANCELLED",
      }),
    );

    await harness.reconciliation.reconcile({
      workflowRun: harness.workflowRun,
      now: T3,
      ids: harness.ids,
    });

    const unchanged = await harness.workflowRuns.findWorkflowNodeRunById(
      waiting.id,
    );
    expect(unchanged?.status).toBe("WAITING");
  });

  it("concurrent ensure calls persist exactly one wait", async () => {
    const harness = await seedHarness(
      agentThenWait({ kind: "DURATION", durationMs: 1_000 }),
    );
    await harness.workflowRuns.saveWorkflowNodeRun(
      succeededAgentNode(harness, {}),
    );

    await Promise.all([
      harness.reconciliation.reconcile({
        workflowRun: harness.workflowRun,
        now: T3,
        ids: harness.ids,
      }),
      harness.reconciliation.reconcile({
        workflowRun: harness.workflowRun,
        now: T3,
        ids: {
          ...harness.ids,
          createWorkflowNodeRunId: harness.ids.createWorkflowNodeRunId,
        },
      }),
    ]);

    const waits = await harness.workflowWaits.listWorkflowWaitsByWorkflowRunId(
      harness.workflowRun.id,
    );
    expect(waits).toHaveLength(1);
  });

  it("makes a successor ready after a WAIT succeeds", async () => {
    const harness = await seedHarness({
      schemaVersion: "3",
      nodes: [
        {
          key: "delay",
          type: "WAIT",
          wait: { kind: "DURATION", durationMs: 1 },
        },
        { key: "done", type: "AGENT", agentVersionId },
      ],
      edges: [{ from: "delay", to: "done" }],
    });
    const waiting = WorkflowNodeRun.rehydrate({
      id: "node-delay" as WorkflowNodeRunId,
      workspaceId,
      workflowRunId: harness.workflowRun.id,
      workflowNodeKey: "delay",
      sequence: 1,
      status: "WAITING",
      input: { payload: 1 },
      startedAt: T0,
      createdAt: T0,
      updatedAt: T0,
    });
    await harness.workflowRuns.saveWorkflowNodeRun(waiting);
    const armed = armWorkflowWait({
      workspaceId,
      workflowRunId: harness.workflowRun.id,
      workflowNodeRunId: waiting.id,
      workflowRunCreatedAt: RUN_CREATED,
      wait: { kind: "DURATION", durationMs: 1 },
      nodeInput: waiting.input,
      armedAt: T0,
    });
    await harness.workflowWaits.saveWorkflowWait(armed.resolveTimer(T3));

    await harness.reconciliation.reconcile({
      workflowRun: harness.workflowRun,
      now: T3,
      ids: harness.ids,
    });

    const nodeRuns = nodeRunsByKey(
      await harness.workflowRuns.listWorkflowNodeRuns(harness.workflowRun.id),
    );
    expect(isNodeReady(harness.graph, "done", nodeRuns)).toBe(true);
  });
});

function agentThenWait(
  wait: WorkflowDefinitionWaitConfigurationV3,
): WorkflowDefinitionV3 {
  return {
    schemaVersion: "3",
    nodes: [
      { key: "step", type: "AGENT", agentVersionId },
      { key: "delay", type: "WAIT", wait },
    ],
    edges: [{ from: "step", to: "delay" }],
  };
}

function waitOnly(
  wait: WorkflowDefinitionWaitConfigurationV3,
): WorkflowDefinitionV3 {
  return {
    schemaVersion: "3",
    nodes: [{ key: "delay", type: "WAIT", wait }],
    edges: [],
  };
}

async function seedHarness(definition: WorkflowDefinitionV3) {
  const workspaces = new MemoryWorkspaceRepository();
  const workflows = new MemoryWorkflowRepository();
  const workflowRuns = new MemoryWorkflowRunRepository();
  const workflowWaits = new MemoryWorkflowWaitRepository();
  await workspaces.save(
    Workspace.create({
      id: workspaceId,
      name: "ws",
      createdAt: RUN_CREATED,
    }),
  );

  const workflow = Workflow.create({
    id: "wf-1" as WorkflowId,
    workspaceId,
    key: "wait-test",
    name: "wait-test",
    createdAt: RUN_CREATED,
    updatedAt: RUN_CREATED,
  });
  await workflows.saveWorkflow(workflow);
  const version = WorkflowVersion.create({
    id: "wv-1" as WorkflowVersionId,
    workspaceId,
    workflowId: workflow.id,
    version: 1,
    definition,
    createdAt: RUN_CREATED,
  });
  await workflows.saveWorkflowVersion(version);

  const workflowRun = WorkflowRun.create({
    id: "wr-1" as WorkflowRunId,
    workspaceId,
    workflowId: workflow.id,
    workflowVersionId: version.id,
    input: { orderId: "ord-9" },
    createdAt: RUN_CREATED,
  });
  const runningWorkflowRun = workflowRun.markRunning(T0);
  await workflowRuns.saveWorkflowRun(runningWorkflowRun);

  const reconciliation = new WorkflowWaitReconciliation({
    workflows,
    workflowRuns,
    workflowWaits,
  });

  let nodeCounter = 0;
  const ids = {
    createWorkflowNodeRunId: () =>
      `node-gen-${++nodeCounter}` as WorkflowNodeRunId,
  };

  const graph = buildWorkflowGraph(definition);

  return {
    workflows,
    workflowRuns,
    workflowWaits,
    workflowRun: runningWorkflowRun,
    reconciliation,
    ids,
    graph,
  };
}

function succeededAgentNode(
  harness: Awaited<ReturnType<typeof seedHarness>>,
  input: { output?: unknown },
) {
  return WorkflowNodeRun.rehydrate({
    id: "node-step" as WorkflowNodeRunId,
    workspaceId,
    workflowRunId: harness.workflowRun.id,
    workflowNodeKey: "step",
    sequence: 1,
    status: "SUCCEEDED",
    input: harness.workflowRun.input,
    output: input.output ?? null,
    startedAt: T0,
    completedAt: T0,
    createdAt: T0,
    updatedAt: T0,
  });
}
