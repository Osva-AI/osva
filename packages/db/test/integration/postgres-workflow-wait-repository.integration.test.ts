import type {
  WorkflowEventId,
  WorkflowId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva/contracts";
import {
  DomainInvariantError,
  Workflow,
  WorkflowEvent,
  WorkflowNodeRun,
  WorkflowRun,
  WorkflowVersion,
  WorkflowWaitResolutionConflictError,
  Workspace,
  armWorkflowWait,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresWorkflowWaitRepository } from "../../src/repositories/postgres-workflow-wait-repository.js";
import { PostgresWorkflowRepository } from "../../src/repositories/postgres-workflow-repository.js";
import { PostgresWorkflowRunRepository } from "../../src/repositories/postgres-workflow-run-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { workflowEvents } from "../../src/schema/index.js";
import { createIds, NOW } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

const RUN_CREATED = new Date("2026-01-01T00:00:00.000Z");
const ARMED_EARLY = new Date("2026-01-01T01:00:00.000Z");
const ARMED_LATE = new Date("2026-01-01T02:00:00.000Z");
const WAKE_AT = new Date("2026-01-01T01:30:00.000Z");
const RESOLVED_AT = new Date("2026-01-01T03:00:00.000Z");
const ELIGIBLE_FROM = new Date("2026-01-01T00:00:00.000Z");
const EXPIRES_AT = new Date("2026-01-01T04:00:00.000Z");

describe("PostgreSQL WorkflowWait repository", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let workflows: PostgresWorkflowRepository;
  let workflowRuns: PostgresWorkflowRunRepository;
  let waits: PostgresWorkflowWaitRepository;

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

  it("persists and reloads an active TIMER wait", async () => {
    const seeded = await seedGraph("timer-active");
    const timer = armTimer(seeded);
    await waits.saveWorkflowWait(timer);

    const loaded = await waits.findWorkflowWaitByWorkflowNodeRunId(
      seeded.workflowNodeRunId,
    );
    expect(loaded).not.toBeNull();
    expect(loaded!.kind).toBe("TIMER");
    expect(loaded!.resolution).toBeUndefined();
    expect(loaded!.wakeAt!.getTime()).toBe(timer.wakeAt!.getTime());
    expect(loaded!.armedAt.getTime()).toBe(ARMED_EARLY.getTime());
  });

  it("persists and reloads an active EVENT wait", async () => {
    const seeded = await seedGraph("event-active");
    const eventWait = armEvent(seeded, {
      armedAt: ARMED_EARLY,
      expiresAt: EXPIRES_AT,
    });
    await waits.saveWorkflowWait(eventWait);

    const loaded = await waits.findWorkflowWaitByWorkflowNodeRunId(
      seeded.workflowNodeRunId,
    );
    expect(loaded!.kind).toBe("EVENT");
    expect(loaded!.eventSource).toBe("billing");
    expect(loaded!.eventType).toBe("invoice.paid");
    expect(loaded!.correlationKey).toBe("corr-1");
    expect(loaded!.eligibleFrom!.getTime()).toBe(ELIGIBLE_FROM.getTime());
    expect(loaded!.expiresAt!.getTime()).toBe(EXPIRES_AT.getTime());
  });

  it("preserves all Date and frozen fields on round-trip", async () => {
    const seeded = await seedGraph("dates");
    const timer = armWorkflowWait({
      workspaceId: seeded.workspaceId,
      workflowRunId: seeded.workflowRunId,
      workflowNodeRunId: seeded.workflowNodeRunId,
      workflowRunCreatedAt: RUN_CREATED,
      wait: { kind: "UNTIL", until: WAKE_AT.toISOString() },
      nodeInput: {},
      armedAt: ARMED_EARLY,
    });
    await waits.saveWorkflowWait(timer);

    const loaded = await waits.findWorkflowWaitByWorkflowNodeRunId(
      seeded.workflowNodeRunId,
    );
    expect(loaded!.wakeAt!.toISOString()).toBe(WAKE_AT.toISOString());
    expect(loaded!.armedAt.toISOString()).toBe(ARMED_EARLY.toISOString());
  });

  it("rejects duplicate workflowNodeRunId", async () => {
    const seeded = await seedGraph("dup");
    await waits.saveWorkflowWait(armTimer(seeded));

    await expect(
      waits.saveWorkflowWait(armTimer(seeded, { armedAt: ARMED_LATE })),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });

  it("lists waits for one workflow run only", async () => {
    const first = await seedGraph("list-a");
    const second = await seedGraph("list-b");
    const nodeB = await seedSecondNodeRun(first, "list-node-b", 2);
    await waits.saveWorkflowWait(armTimer(first));
    await waits.saveWorkflowWait(
      armEvent(first, { workflowNodeRunId: nodeB, armedAt: ARMED_LATE }),
    );
    await waits.saveWorkflowWait(armTimer(second));

    const listed = await waits.listWorkflowWaitsByWorkflowRunId(
      first.workflowRunId,
    );
    expect(listed.map((wait) => wait.workflowNodeRunId)).toEqual([
      first.workflowNodeRunId,
      nodeB,
    ]);
  });

  it("orders waits by armedAt then workflowNodeRunId", async () => {
    const seeded = await seedGraph("order");
    const nodeB = await seedSecondNodeRun(seeded, "order-b", 2);
    const nodeC = await seedSecondNodeRun(seeded, "order-c", 3);
    await waits.saveWorkflowWait(
      armTimer(seeded, { workflowNodeRunId: nodeB, armedAt: ARMED_LATE }),
    );
    await waits.saveWorkflowWait(armTimer(seeded, { armedAt: ARMED_EARLY }));
    await waits.saveWorkflowWait(
      armEvent(seeded, {
        workflowNodeRunId: nodeC,
        armedAt: ARMED_EARLY,
      }),
    );

    const listed = await waits.listWorkflowWaitsByWorkflowRunId(
      seeded.workflowRunId,
    );
    expect(listed.map((wait) => wait.workflowNodeRunId)).toEqual([
      seeded.workflowNodeRunId,
      nodeC,
      nodeB,
    ]);
  });

  it("persists concurrent equivalent TIMER resolutions once", async () => {
    const seeded = await seedGraph("cas-timer");
    const active = armTimer(seeded, { armedAt: ARMED_EARLY });
    await waits.saveWorkflowWait(active);
    const resolved = active.resolveTimer(RESOLVED_AT);

    const [first, second] = await Promise.all([
      waits.saveWorkflowWaitResolution(resolved),
      waits.saveWorkflowWaitResolution(resolved),
    ]);

    expect(first.resolution).toBe("TIMER");
    expect(second.resolution).toBe("TIMER");
    expect(first.resolvedAt!.getTime()).toBe(second.resolvedAt!.getTime());
    expect(first.resolvedAt!.getTime()).toBe(RESOLVED_AT.getTime());

    const rows = await database.sql<
      { resolution: string | null; resolved_at: Date | null }[]
    >`select resolution, resolved_at from workflow_waits where workflow_node_run_id = ${seeded.workflowNodeRunId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.resolution).toBe("TIMER");
  });

  it("allows only one winner for conflicting concurrent resolutions", async () => {
    const seeded = await seedGraph("cas-conflict");
    const active = armTimer(seeded, { armedAt: ARMED_EARLY });
    await waits.saveWorkflowWait(active);

    const results = await Promise.allSettled([
      waits.saveWorkflowWaitResolution(active.resolveTimer(RESOLVED_AT)),
      waits.saveWorkflowWaitResolution(active.cancel(RESOLVED_AT)),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      WorkflowWaitResolutionConflictError,
    );

    const stored = await waits.findWorkflowWaitByWorkflowNodeRunId(
      seeded.workflowNodeRunId,
    );
    expect(
      stored?.resolution === "TIMER" || stored?.resolution === "CANCELLED",
    ).toBe(true);
  });

  it("rehydrates a resolved TIMER wait", async () => {
    const seeded = await seedGraph("resolved-timer");
    const active = armTimer(seeded, { armedAt: ARMED_EARLY });
    const resolved = active.resolveTimer(RESOLVED_AT);
    await waits.saveWorkflowWait(resolved);

    const loaded = await waits.findWorkflowWaitByWorkflowNodeRunId(
      seeded.workflowNodeRunId,
    );
    expect(loaded!.resolution).toBe("TIMER");
    expect(loaded!.resolvedAt!.getTime()).toBe(RESOLVED_AT.getTime());
    expect(loaded!.resolvedByEventId).toBeUndefined();
  });

  it("rehydrates a resolved EVENT wait with resolvedByEventId", async () => {
    const seeded = await seedGraph("resolved-event");
    const eventId = "evt-resolved-1" as WorkflowEventId;
    await database.db.insert(workflowEvents).values({
      id: eventId,
      workspaceId: seeded.workspaceId,
      source: "billing",
      eventType: "invoice.paid",
      correlationKey: "corr-1",
      idempotencyKey: "idem-resolved-1",
      payload: { ok: true },
      receivedAt: ARMED_EARLY,
    });

    const active = armEvent(seeded, { armedAt: ARMED_EARLY });
    const workflowEvent = WorkflowEvent.create({
      id: eventId,
      workspaceId: seeded.workspaceId,
      source: "billing",
      eventType: "invoice.paid",
      correlationKey: "corr-1",
      idempotencyKey: "idem-resolved-1",
      payload: { ok: true },
      receivedAt: ARMED_EARLY,
    });
    const resolved = active.resolveEvent(workflowEvent, RESOLVED_AT);
    await waits.saveWorkflowWait(resolved);

    const loaded = await waits.findWorkflowWaitByWorkflowNodeRunId(
      seeded.workflowNodeRunId,
    );
    expect(loaded!.resolution).toBe("EVENT");
    expect(loaded!.resolvedByEventId).toBe(eventId);
    expect(loaded!.resolvedAt!.getTime()).toBe(RESOLVED_AT.getTime());
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

  function armTimer(
    seeded: {
      readonly workspaceId: WorkspaceId;
      readonly workflowRunId: WorkflowRunId;
      readonly workflowNodeRunId: WorkflowNodeRunId;
    },
    options: {
      readonly workflowNodeRunId?: WorkflowNodeRunId;
      readonly armedAt?: Date;
    } = {},
  ) {
    return armWorkflowWait({
      workspaceId: seeded.workspaceId,
      workflowRunId: seeded.workflowRunId,
      workflowNodeRunId: options.workflowNodeRunId ?? seeded.workflowNodeRunId,
      workflowRunCreatedAt: RUN_CREATED,
      wait: { kind: "DURATION", durationMs: 60_000 },
      nodeInput: {},
      armedAt: options.armedAt ?? ARMED_EARLY,
    });
  }

  function armEvent(
    seeded: {
      readonly workspaceId: WorkspaceId;
      readonly workflowRunId: WorkflowRunId;
      readonly workflowNodeRunId: WorkflowNodeRunId;
    },
    options: {
      readonly workflowNodeRunId?: WorkflowNodeRunId;
      readonly armedAt?: Date;
      readonly expiresAt?: Date;
    } = {},
  ) {
    return armWorkflowWait({
      workspaceId: seeded.workspaceId,
      workflowRunId: seeded.workflowRunId,
      workflowNodeRunId: options.workflowNodeRunId ?? seeded.workflowNodeRunId,
      workflowRunCreatedAt: RUN_CREATED,
      wait: {
        kind: "EVENT",
        source: "billing",
        eventType: "invoice.paid",
        correlation: { kind: "LITERAL", value: "corr-1" },
        timeoutMs:
          options.expiresAt === undefined
            ? undefined
            : options.expiresAt.getTime() -
              (options.armedAt ?? ARMED_EARLY).getTime(),
      },
      nodeInput: {},
      armedAt: options.armedAt ?? ARMED_EARLY,
    });
  }
});
