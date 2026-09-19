import type {
  WorkflowId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva/contracts";
import {
  Workflow,
  WorkflowNodeRun,
  WorkflowRun,
  WorkflowVersion,
  Workspace,
  armWorkflowWait,
} from "@osva/domain";
import {
  PostgresWorkflowRepository,
  PostgresWorkflowRunRepository,
  PostgresWorkflowTimerWaitResolutionRepository,
  PostgresWorkflowWaitRepository,
  PostgresWorkspaceRepository,
  createDatabase,
  migrateDatabase,
  type Database,
} from "@osva/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ProcessDueTimerWaits } from "../../src/process-due-timer-waits.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "../../../db/test/integration/postgres-harness.js";
import { createIds, NOW } from "../../../db/test/integration/fixtures.js";

const RUN_CREATED = new Date("2026-01-01T00:00:00.000Z");
const ARMED = new Date("2026-01-01T01:00:00.000Z");
const DUE_NOW = new Date("2026-01-01T05:00:00.000Z");

describe("ProcessDueTimerWaits PostgreSQL integration", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let workflows: PostgresWorkflowRepository;
  let workflowRuns: PostgresWorkflowRunRepository;
  let waits: PostgresWorkflowWaitRepository;
  let processor: ProcessDueTimerWaits;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    workspaces = new PostgresWorkspaceRepository(database);
    workflows = new PostgresWorkflowRepository(database);
    workflowRuns = new PostgresWorkflowRunRepository(database);
    waits = new PostgresWorkflowWaitRepository(database);
    processor = new ProcessDueTimerWaits({
      workflowWaits: waits,
      timerWaitResolution: new PostgresWorkflowTimerWaitResolutionRepository(
        database,
      ),
    });
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

  it("discovers and resolves due TIMER waits", async () => {
    const seeded = await seedGraph("due-one");
    await waits.saveWorkflowWait(armDuration(seeded));

    const resolved = await processor.execute(DUE_NOW, 10);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.resolution).toBe("TIMER");
  });

  it("leaves future TIMER waits untouched", async () => {
    const seeded = await seedGraph("future");
    await waits.saveWorkflowWait(armUntil(seeded, "2026-01-01T10:00:00.000Z"));

    expect(await processor.execute(DUE_NOW, 10)).toHaveLength(0);
  });

  it("bounds processing by limit", async () => {
    const seeded = await seedGraph("limit");
    const nodeB = await seedSecondNodeRun(seeded, "limit-b", 2);
    const nodeC = await seedSecondNodeRun(seeded, "limit-c", 3);
    await waits.saveWorkflowWait(armDuration(seeded));
    await waits.saveWorkflowWait(armDuration(seeded, nodeB));
    await waits.saveWorkflowWait(armDuration(seeded, nodeC));

    expect(await processor.execute(DUE_NOW, 2)).toHaveLength(2);
  });

  it("orders due TIMER waits by wakeAt then workflowNodeRunId", async () => {
    const seeded = await seedGraph("order");
    const nodeB = await seedSecondNodeRun(seeded, "order-b", 2);
    await waits.saveWorkflowWait(armUntil(seeded, "2026-01-01T03:00:00.000Z"));
    await waits.saveWorkflowWait(
      armUntil(seeded, "2026-01-01T02:00:00.000Z", nodeB),
    );

    const resolved = await processor.execute(DUE_NOW, 10);
    expect(resolved.map((wait) => wait.workflowNodeRunId)).toEqual([
      nodeB,
      seeded.workflowNodeRunId,
    ]);
  });

  it("is idempotent when processing repeats", async () => {
    const seeded = await seedGraph("repeat");
    await waits.saveWorkflowWait(armDuration(seeded));

    await processor.execute(DUE_NOW, 10);
    expect(await processor.execute(DUE_NOW, 10)).toHaveLength(0);
  });

  it("does not discover or resolve TIMER waits for terminal workflow runs", async () => {
    const seeded = await seedGraph("terminal-timer");
    await waits.saveWorkflowWait(armDuration(seeded));
    const active = await workflowRuns.findWorkflowRunById(seeded.workflowRunId);
    expect(active).not.toBeNull();
    const running = await workflowRuns.transitionWorkflowRun(
      "PENDING",
      active!.markRunning(NOW),
    );
    await workflowRuns.transitionWorkflowRun(
      "RUNNING",
      running.markSucceeded(NOW, { ok: true }),
    );

    expect(await processor.execute(DUE_NOW, 10)).toHaveLength(0);
    const stored = await waits.findWorkflowWaitByWorkflowNodeRunId(
      seeded.workflowNodeRunId,
    );
    expect(stored?.resolution).toBeUndefined();
  });

  it("handles concurrent processors without conflicting resolution", async () => {
    const seeded = await seedGraph("concurrent");
    await waits.saveWorkflowWait(armDuration(seeded));

    const [first, second] = await Promise.all([
      processor.execute(DUE_NOW, 10),
      processor.execute(DUE_NOW, 10),
    ]);

    expect(first.length + second.length).toBeGreaterThanOrEqual(1);
    const stored = await waits.findWorkflowWaitByWorkflowNodeRunId(
      seeded.workflowNodeRunId,
    );
    expect(stored?.resolution).toBe("TIMER");
  });

  async function seedGraph(label: string): Promise<{
    readonly workspaceId: WorkspaceId;
    readonly workflowRunId: WorkflowRunId;
    readonly workflowNodeRunId: WorkflowNodeRunId;
  }> {
    const ids = createIds(label);
    await workspaces.save(
      Workspace.create({
        id: ids.workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );
    const workflowId = `workflow-${label}` as WorkflowId;
    await workflows.saveWorkflow(
      Workflow.create({
        id: workflowId,
        workspaceId: ids.workspaceId,
        key: `wf-${label}`,
        name: "Workflow",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
    await workflows.saveWorkflowVersion(
      WorkflowVersion.create({
        id: `workflow-version-${label}` as WorkflowVersionId,
        workflowId,
        workspaceId: ids.workspaceId,
        version: 1,
        definition: {
          schemaVersion: "2",
          nodes: [{ key: "wait", type: "APPROVAL", title: "Wait" }],
          edges: [],
        },
        createdAt: NOW,
      }),
    );
    const workflowRunId = `workflow-run-${label}` as WorkflowRunId;
    await workflowRuns.saveWorkflowRun(
      WorkflowRun.create({
        id: workflowRunId,
        workspaceId: ids.workspaceId,
        workflowId,
        workflowVersionId: `workflow-version-${label}` as WorkflowVersionId,
        input: {},
        createdAt: RUN_CREATED,
      }),
    );
    const workflowNodeRunId = `node-run-${label}` as WorkflowNodeRunId;
    await workflowRuns.saveWorkflowNodeRun(
      WorkflowNodeRun.create({
        id: workflowNodeRunId,
        workspaceId: ids.workspaceId,
        workflowRunId,
        workflowNodeKey: "wait",
        sequence: 1,
        input: {},
        createdAt: NOW,
      }),
    );
    return {
      workspaceId: ids.workspaceId,
      workflowRunId,
      workflowNodeRunId,
    };
  }

  async function seedSecondNodeRun(
    seeded: {
      readonly workspaceId: WorkspaceId;
      readonly workflowRunId: WorkflowRunId;
    },
    label: string,
    sequence: number,
  ): Promise<WorkflowNodeRunId> {
    const workflowNodeRunId = `node-run-${label}` as WorkflowNodeRunId;
    await workflowRuns.saveWorkflowNodeRun(
      WorkflowNodeRun.create({
        id: workflowNodeRunId,
        workspaceId: seeded.workspaceId,
        workflowRunId: seeded.workflowRunId,
        workflowNodeKey: `wait-${label}`,
        sequence,
        input: {},
        createdAt: NOW,
      }),
    );
    return workflowNodeRunId;
  }

  function armDuration(
    seeded: {
      readonly workspaceId: WorkspaceId;
      readonly workflowRunId: WorkflowRunId;
      readonly workflowNodeRunId: WorkflowNodeRunId;
    },
    workflowNodeRunId: WorkflowNodeRunId = seeded.workflowNodeRunId,
  ) {
    return armWorkflowWait({
      workspaceId: seeded.workspaceId,
      workflowRunId: seeded.workflowRunId,
      workflowNodeRunId,
      workflowRunCreatedAt: RUN_CREATED,
      wait: { kind: "DURATION", durationMs: 60_000 },
      nodeInput: {},
      armedAt: ARMED,
    });
  }

  function armUntil(
    seeded: {
      readonly workspaceId: WorkspaceId;
      readonly workflowRunId: WorkflowRunId;
      readonly workflowNodeRunId: WorkflowNodeRunId;
    },
    until: string,
    workflowNodeRunId: WorkflowNodeRunId = seeded.workflowNodeRunId,
  ) {
    return armWorkflowWait({
      workspaceId: seeded.workspaceId,
      workflowRunId: seeded.workflowRunId,
      workflowNodeRunId,
      workflowRunCreatedAt: RUN_CREATED,
      wait: { kind: "UNTIL", until },
      nodeInput: {},
      armedAt: ARMED,
    });
  }
});
