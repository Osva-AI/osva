import type {
  WorkflowEventId,
  WorkflowId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva/contracts";
import {
  Workflow,
  WorkflowEvent,
  WorkflowNodeRun,
  WorkflowRun,
  WorkflowVersion,
  Workspace,
  armWorkflowWait,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresWorkflowEventRepository } from "../../src/repositories/postgres-workflow-event-repository.js";
import { PostgresWorkflowEventWaitResolutionRepository } from "../../src/repositories/postgres-workflow-event-wait-resolution-repository.js";
import { PostgresWorkflowRepository } from "../../src/repositories/postgres-workflow-repository.js";
import { PostgresWorkflowRunRepository } from "../../src/repositories/postgres-workflow-run-repository.js";
import { PostgresWorkflowWaitRepository } from "../../src/repositories/postgres-workflow-wait-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { createIds, NOW } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

const RUN_CREATED = new Date("2026-01-01T10:00:00.000Z");
const ARMED = new Date("2026-01-01T10:05:00.000Z");
const TIMEOUT_MS = 55 * 60_000;

describe("PostgreSQL WorkflowEvent wait resolution", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let workflows: PostgresWorkflowRepository;
  let workflowRuns: PostgresWorkflowRunRepository;
  let waits: PostgresWorkflowWaitRepository;
  let events: PostgresWorkflowEventRepository;
  let resolution: PostgresWorkflowEventWaitResolutionRepository;

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
    events = new PostgresWorkflowEventRepository(database);
    resolution = new PostgresWorkflowEventWaitResolutionRepository(database);
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

  it("resolves an eligible durable event inside the transaction", async () => {
    const seeded = await seedGraph("resolve-event");
    await waits.saveWorkflowWait(armEvent(seeded));
    await events.saveWorkflowEvent(
      WorkflowEvent.create({
        id: "evt-1" as WorkflowEventId,
        workspaceId: seeded.workspaceId,
        source: "payments",
        eventType: "payment.completed",
        correlationKey: "ord-1",
        idempotencyKey: "idem-1",
        payload: { ok: true },
        receivedAt: new Date("2026-01-01T10:30:00.000Z"),
      }),
    );

    const resolved = await resolution.resolveWorkflowEventWait(
      seeded.workflowNodeRunId,
      new Date("2026-01-01T11:30:00.000Z"),
    );
    expect(resolved.resolution).toBe("EVENT");
    expect(resolved.resolvedByEventId).toBe("evt-1");
  });

  it("stores resolvedByEventId on EVENT resolution", async () => {
    const seeded = await seedGraph("resolved-by");
    await waits.saveWorkflowWait(armEvent(seeded));
    await events.saveWorkflowEvent(
      WorkflowEvent.create({
        id: "evt-rb" as WorkflowEventId,
        workspaceId: seeded.workspaceId,
        source: "payments",
        eventType: "payment.completed",
        correlationKey: "ord-1",
        idempotencyKey: "idem-rb",
        payload: {},
        receivedAt: new Date("2026-01-01T10:20:00.000Z"),
      }),
    );

    const resolved = await resolution.resolveWorkflowEventWait(
      seeded.workflowNodeRunId,
      new Date("2026-01-01T11:30:00.000Z"),
    );
    const reloaded = await waits.findWorkflowWaitByWorkflowNodeRunId(
      seeded.workflowNodeRunId,
    );
    expect(reloaded?.resolvedByEventId).toBe(resolved.resolvedByEventId);
  });

  it("prefers durable eligible event over timeout when processing late", async () => {
    const seeded = await seedGraph("late-event");
    await waits.saveWorkflowWait(armEvent(seeded));
    await events.saveWorkflowEvent(
      WorkflowEvent.create({
        id: "evt-late" as WorkflowEventId,
        workspaceId: seeded.workspaceId,
        source: "payments",
        eventType: "payment.completed",
        correlationKey: "ord-1",
        idempotencyKey: "idem-late",
        payload: {},
        receivedAt: new Date("2026-01-01T10:59:00.000Z"),
      }),
    );

    const resolved = await resolution.resolveWorkflowEventWait(
      seeded.workflowNodeRunId,
      new Date("2026-01-01T11:05:00.000Z"),
    );
    expect(resolved.resolution).toBe("EVENT");
  });

  it("returns active wait unchanged when WorkflowRun is terminal", async () => {
    const seeded = await seedGraph("terminal-run");
    await waits.saveWorkflowWait(armEvent(seeded));
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

    const resolved = await resolution.resolveWorkflowEventWait(
      seeded.workflowNodeRunId,
      new Date("2026-01-01T11:30:00.000Z"),
    );
    expect(resolved.resolution).toBeUndefined();
  });

  it("times out when no candidate exists", async () => {
    const seeded = await seedGraph("timeout");
    await waits.saveWorkflowWait(armEvent(seeded));

    const resolved = await resolution.resolveWorkflowEventWait(
      seeded.workflowNodeRunId,
      new Date("2026-01-01T11:30:00.000Z"),
    );
    expect(resolved.resolution).toBe("TIMEOUT");
  });

  it("selects deterministic earliest receivedAt then id", async () => {
    const seeded = await seedGraph("deterministic");
    await waits.saveWorkflowWait(armEvent(seeded));
    const at = new Date("2026-01-01T10:25:00.000Z");
    await events.saveWorkflowEvent(
      WorkflowEvent.create({
        id: "evt-b" as WorkflowEventId,
        workspaceId: seeded.workspaceId,
        source: "payments",
        eventType: "payment.completed",
        correlationKey: "ord-1",
        idempotencyKey: "idem-b",
        payload: {},
        receivedAt: at,
      }),
    );
    await events.saveWorkflowEvent(
      WorkflowEvent.create({
        id: "evt-a" as WorkflowEventId,
        workspaceId: seeded.workspaceId,
        source: "payments",
        eventType: "payment.completed",
        correlationKey: "ord-1",
        idempotencyKey: "idem-a",
        payload: {},
        receivedAt: at,
      }),
    );

    const resolved = await resolution.resolveWorkflowEventWait(
      seeded.workflowNodeRunId,
      new Date("2026-01-01T11:30:00.000Z"),
    );
    expect(resolved.resolvedByEventId).toBe("evt-a");
  });

  it("is idempotent under concurrent duplicate decisions", async () => {
    const seeded = await seedGraph("concurrent-idem");
    await waits.saveWorkflowWait(armEvent(seeded));
    await events.saveWorkflowEvent(
      WorkflowEvent.create({
        id: "evt-c" as WorkflowEventId,
        workspaceId: seeded.workspaceId,
        source: "payments",
        eventType: "payment.completed",
        correlationKey: "ord-1",
        idempotencyKey: "idem-c",
        payload: {},
        receivedAt: new Date("2026-01-01T10:30:00.000Z"),
      }),
    );

    const [first, second] = await Promise.all([
      resolution.resolveWorkflowEventWait(
        seeded.workflowNodeRunId,
        new Date("2026-01-01T11:30:00.000Z"),
      ),
      resolution.resolveWorkflowEventWait(
        seeded.workflowNodeRunId,
        new Date("2026-01-01T11:30:00.000Z"),
      ),
    ]);

    expect(first.resolution).toBe("EVENT");
    expect(second.resolution).toBe("EVENT");
    expect(first.resolvedAt!.getTime()).toBe(second.resolvedAt!.getTime());
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
        input: { orderId: "ord-1" },
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
        input: { orderId: "ord-1" },
        createdAt: NOW,
      }),
    );
    return {
      workspaceId: ids.workspaceId,
      workflowRunId,
      workflowNodeRunId,
    };
  }

  function armEvent(seeded: {
    readonly workspaceId: WorkspaceId;
    readonly workflowRunId: WorkflowRunId;
    readonly workflowNodeRunId: WorkflowNodeRunId;
  }) {
    return armWorkflowWait({
      workspaceId: seeded.workspaceId,
      workflowRunId: seeded.workflowRunId,
      workflowNodeRunId: seeded.workflowNodeRunId,
      workflowRunCreatedAt: RUN_CREATED,
      armedAt: ARMED,
      nodeInput: { orderId: "ord-1" },
      wait: {
        kind: "EVENT",
        source: "payments",
        eventType: "payment.completed",
        correlation: { kind: "LITERAL", value: "ord-1" },
        timeoutMs: TIMEOUT_MS,
      },
    });
  }
});
