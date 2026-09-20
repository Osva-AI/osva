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
  WorkflowNodeRun,
  WorkflowRun,
  WorkflowVersion,
  Workspace,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { postgresErrorCode } from "../../src/postgres-errors.js";
import { workflowEvents, workflowWaits } from "../../src/schema/index.js";
import { PostgresWorkflowRepository } from "../../src/repositories/postgres-workflow-repository.js";
import { PostgresWorkflowRunRepository } from "../../src/repositories/postgres-workflow-run-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { createIds, LATER, NOW } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

const BEFORE_ARMED = new Date("2026-01-15T11:00:00.000Z");
const AFTER_ARMED = new Date("2026-01-15T13:00:00.000Z");

describe("PostgreSQL workflow wait and event schema", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let workflows: PostgresWorkflowRepository;
  let workflowRuns: PostgresWorkflowRunRepository;

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

  const insertTimer = (values: TimerWaitInsert) =>
    insertTimerWait(database, values);
  const insertEvent = (values: EventWaitInsert) =>
    insertEventWait(database, values);
  const insertEventRow = (values: WorkflowEventInsert) =>
    insertWorkflowEvent(database, values);

  it("persists a valid active TIMER wait with wakeAt before armedAt", async () => {
    const seeded = await seedGraph("timer-active");
    await insertTimer({
      workflowNodeRunId: seeded.workflowNodeRunId,
      workspaceId: seeded.workspaceId,
      workflowRunId: seeded.workflowRunId,
      armedAt: NOW,
      wakeAt: BEFORE_ARMED,
    });

    const rows = await database.sql<
      { wake_at: Date; armed_at: Date }[]
    >`select wake_at, armed_at from workflow_waits where workflow_node_run_id = ${seeded.workflowNodeRunId}`;
    expect(rows).toHaveLength(1);
    expect(timestampMs(rows[0]!.wake_at)).toBe(BEFORE_ARMED.getTime());
    expect(timestampMs(rows[0]!.armed_at)).toBe(NOW.getTime());
  });

  it("persists a valid active EVENT wait", async () => {
    const seeded = await seedGraph("event-active");
    await insertEvent({
      workflowNodeRunId: seeded.workflowNodeRunId,
      workspaceId: seeded.workspaceId,
      workflowRunId: seeded.workflowRunId,
      armedAt: NOW,
      eligibleFrom: BEFORE_ARMED,
      expiresAt: AFTER_ARMED,
    });

    const rows = await database.sql<
      { eligible_from: Date; expires_at: Date }[]
    >`select eligible_from, expires_at from workflow_waits where workflow_node_run_id = ${seeded.workflowNodeRunId}`;
    expect(rows).toHaveLength(1);
    expect(timestampMs(rows[0]!.eligible_from)).toBe(BEFORE_ARMED.getTime());
    expect(timestampMs(rows[0]!.expires_at)).toBe(AFTER_ARMED.getTime());
  });

  it("rejects duplicate workflow_node_run_id", async () => {
    const seeded = await seedGraph("dup-wait");
    await insertTimer({
      workflowNodeRunId: seeded.workflowNodeRunId,
      workspaceId: seeded.workspaceId,
      workflowRunId: seeded.workflowRunId,
      armedAt: NOW,
      wakeAt: LATER,
    });

    await expectDbViolation(() =>
      insertTimer({
        workflowNodeRunId: seeded.workflowNodeRunId,
        workspaceId: seeded.workspaceId,
        workflowRunId: seeded.workflowRunId,
        armedAt: NOW,
        wakeAt: LATER,
      }),
    );
  });

  it("rejects workflow_run_id that does not match the WorkflowNodeRun", async () => {
    const first = await seedGraph("coherence-a");
    const second = await seedSecondRunInWorkspace(
      "coherence-b",
      first.workspaceId,
    );

    await expectDbViolation(() =>
      insertTimer({
        workflowNodeRunId: first.workflowNodeRunId,
        workspaceId: first.workspaceId,
        workflowRunId: second.workflowRunId,
        armedAt: NOW,
        wakeAt: LATER,
      }),
    );
  });

  it("rejects half-resolved wait rows", async () => {
    const seeded = await seedGraph("half-resolved");
    await expectDbViolation(() =>
      insertTimer({
        workflowNodeRunId: seeded.workflowNodeRunId,
        workspaceId: seeded.workspaceId,
        workflowRunId: seeded.workflowRunId,
        armedAt: NOW,
        wakeAt: LATER,
        resolution: "TIMER",
      }),
    );
    await expectDbViolation(() =>
      insertTimer({
        workflowNodeRunId: seeded.workflowNodeRunId,
        workspaceId: seeded.workspaceId,
        workflowRunId: seeded.workflowRunId,
        armedAt: NOW,
        wakeAt: LATER,
        resolvedAt: LATER,
      }),
    );
  });

  it("rejects incompatible TIMER resolutions", async () => {
    const eventCase = await seedGraph("timer-event-res");
    await expectDbViolation(() =>
      insertTimer({
        workflowNodeRunId: eventCase.workflowNodeRunId,
        workspaceId: eventCase.workspaceId,
        workflowRunId: eventCase.workflowRunId,
        armedAt: NOW,
        wakeAt: BEFORE_ARMED,
        resolution: "EVENT",
        resolvedAt: LATER,
        resolvedByEventId: "evt-missing" as WorkflowEventId,
      }),
    );

    const timeoutCase = await seedGraph("timer-timeout-res");
    await expectDbViolation(() =>
      insertTimer({
        workflowNodeRunId: timeoutCase.workflowNodeRunId,
        workspaceId: timeoutCase.workspaceId,
        workflowRunId: timeoutCase.workflowRunId,
        armedAt: NOW,
        wakeAt: BEFORE_ARMED,
        resolution: "TIMEOUT",
        resolvedAt: LATER,
      }),
    );
  });

  it("rejects EVENT wait with TIMER resolution", async () => {
    const seeded = await seedGraph("event-timer-res");
    await expectDbViolation(() =>
      insertEvent({
        workflowNodeRunId: seeded.workflowNodeRunId,
        workspaceId: seeded.workspaceId,
        workflowRunId: seeded.workflowRunId,
        armedAt: NOW,
        eligibleFrom: BEFORE_ARMED,
        resolution: "TIMER",
        resolvedAt: LATER,
      }),
    );
  });

  it("requires resolvedByEventId for EVENT resolution", async () => {
    const seeded = await seedGraph("event-res-no-evt");
    await expectDbViolation(() =>
      insertEvent({
        workflowNodeRunId: seeded.workflowNodeRunId,
        workspaceId: seeded.workspaceId,
        workflowRunId: seeded.workflowRunId,
        armedAt: NOW,
        eligibleFrom: BEFORE_ARMED,
        resolution: "EVENT",
        resolvedAt: LATER,
      }),
    );

    const eventId = "workflow-event-1" as WorkflowEventId;
    await insertEventRow({
      id: eventId,
      workspaceId: seeded.workspaceId,
      source: "billing",
      idempotencyKey: "idem-1",
    });
    await insertEvent({
      workflowNodeRunId: seeded.workflowNodeRunId,
      workspaceId: seeded.workspaceId,
      workflowRunId: seeded.workflowRunId,
      armedAt: NOW,
      eligibleFrom: BEFORE_ARMED,
      resolution: "EVENT",
      resolvedAt: AFTER_ARMED,
      resolvedByEventId: eventId,
    });
  });

  it("rejects resolvedByEventId for non-EVENT resolutions", async () => {
    const seeded = await seedGraph("non-event-ref");
    const eventId = "workflow-event-timer" as WorkflowEventId;
    await insertEventRow({
      id: eventId,
      workspaceId: seeded.workspaceId,
      source: "billing",
      idempotencyKey: "idem-timer",
    });
    await expectDbViolation(() =>
      insertTimer({
        workflowNodeRunId: seeded.workflowNodeRunId,
        workspaceId: seeded.workspaceId,
        workflowRunId: seeded.workflowRunId,
        armedAt: NOW,
        wakeAt: BEFORE_ARMED,
        resolution: "TIMER",
        resolvedAt: LATER,
        resolvedByEventId: eventId,
      }),
    );
  });

  it("requires expiresAt for EVENT TIMEOUT resolution", async () => {
    const seeded = await seedGraph("timeout-no-expires");
    await expectDbViolation(() =>
      insertEvent({
        workflowNodeRunId: seeded.workflowNodeRunId,
        workspaceId: seeded.workspaceId,
        workflowRunId: seeded.workflowRunId,
        armedAt: NOW,
        eligibleFrom: BEFORE_ARMED,
        resolution: "TIMEOUT",
        resolvedAt: LATER,
      }),
    );
  });

  it("allows flexible WorkflowEvent and resolution timestamps", async () => {
    const seeded = await seedGraph("timestamps");
    await insertEventRow({
      id: "workflow-event-ts" as WorkflowEventId,
      workspaceId: seeded.workspaceId,
      source: "ops",
      idempotencyKey: "idem-ts",
      occurredAt: AFTER_ARMED,
      receivedAt: BEFORE_ARMED,
    });

    const eventId = "workflow-event-late-res" as WorkflowEventId;
    await insertEventRow({
      id: eventId,
      workspaceId: seeded.workspaceId,
      source: "ops",
      idempotencyKey: "idem-late-res",
    });
    await insertEvent({
      workflowNodeRunId: seeded.workflowNodeRunId,
      workspaceId: seeded.workspaceId,
      workflowRunId: seeded.workflowRunId,
      armedAt: NOW,
      eligibleFrom: BEFORE_ARMED,
      expiresAt: LATER,
      resolution: "EVENT",
      resolvedAt: AFTER_ARMED,
      resolvedByEventId: eventId,
    });
  });

  it("enforces WorkflowEvent ingestion uniqueness per workspace and source", async () => {
    const seeded = await seedGraph("event-idem");
    await insertEventRow({
      id: "workflow-event-a" as WorkflowEventId,
      workspaceId: seeded.workspaceId,
      source: "crm",
      idempotencyKey: "shared-key",
    });
    await expectDbViolation(() =>
      insertEventRow({
        id: "workflow-event-b" as WorkflowEventId,
        workspaceId: seeded.workspaceId,
        source: "crm",
        idempotencyKey: "shared-key",
      }),
    );
    await insertEventRow({
      id: "workflow-event-c" as WorkflowEventId,
      workspaceId: seeded.workspaceId,
      source: "other-source",
      idempotencyKey: "shared-key",
    });
  });

  it("rejects cross-workspace resolvedByEventId", async () => {
    const workspaceA = await seedGraph("ws-a");
    const workspaceB = await seedGraph("ws-b");
    const eventId = "workflow-event-ws-b" as WorkflowEventId;
    await insertEventRow({
      id: eventId,
      workspaceId: workspaceB.workspaceId,
      source: "external",
      idempotencyKey: "ws-b-only",
    });

    await expectDbViolation(() =>
      insertEvent({
        workflowNodeRunId: workspaceA.workflowNodeRunId,
        workspaceId: workspaceA.workspaceId,
        workflowRunId: workspaceA.workflowRunId,
        armedAt: NOW,
        eligibleFrom: BEFORE_ARMED,
        resolution: "EVENT",
        resolvedAt: LATER,
        resolvedByEventId: eventId,
      }),
    );
  });

  it("exposes wait/event lookup indexes in the catalog", async () => {
    const rows = await database.sql<{ indexname: string }[]>`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'workflow_waits_timer_due_idx',
          'workflow_waits_event_timeout_idx',
          'workflow_waits_event_match_idx',
          'workflow_events_candidate_lookup_idx'
        )
    `;
    expect(rows.map((row) => row.indexname).sort()).toEqual(
      [
        "workflow_events_candidate_lookup_idx",
        "workflow_waits_event_match_idx",
        "workflow_waits_event_timeout_idx",
        "workflow_waits_timer_due_idx",
      ].sort(),
    );
  });

  it("retains migration journal entries 17 through 21 in order", async () => {
    const journalModule = await import("../../drizzle/meta/_journal.json");
    const journal = journalModule.default ?? journalModule;
    const tail = journal.entries
      .slice(-5)
      .map((entry: { idx: number; tag: string }) => ({
        idx: entry.idx,
        tag: entry.tag,
      }));
    expect(tail).toEqual([
      { idx: 17, tag: "0017_workflow_waiting_state" },
      { idx: 18, tag: "0018_workflow_wait_event_slice" },
      { idx: 19, tag: "0019_artifact_storage_slice" },
      { idx: 20, tag: "0020_knowledge_retrieval_slice" },
      { idx: 21, tag: "0021_knowledge_runtime_slice" },
    ]);
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
          nodes: [{ key: "review", type: "APPROVAL", title: "Review" }],
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
        createdAt: NOW,
      }),
    );
    const workflowNodeRunId = `node-run-${label}` as WorkflowNodeRunId;
    await workflowRuns.saveWorkflowNodeRun(
      WorkflowNodeRun.create({
        id: workflowNodeRunId,
        workspaceId: ids.workspaceId,
        workflowRunId,
        workflowNodeKey: "review",
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

  async function seedSecondRunInWorkspace(
    label: string,
    workspaceId: WorkspaceId,
  ): Promise<{ readonly workflowRunId: WorkflowRunId }> {
    const workflowId = `workflow-${label}` as WorkflowId;
    await workflows.saveWorkflow(
      Workflow.create({
        id: workflowId,
        workspaceId,
        key: `wf-${label}`,
        name: "Workflow B",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
    await workflows.saveWorkflowVersion(
      WorkflowVersion.create({
        id: `workflow-version-${label}` as WorkflowVersionId,
        workflowId,
        workspaceId,
        version: 1,
        definition: {
          schemaVersion: "2",
          nodes: [{ key: "review", type: "APPROVAL", title: "Review" }],
          edges: [],
        },
        createdAt: NOW,
      }),
    );
    const workflowRunId = `workflow-run-${label}` as WorkflowRunId;
    await workflowRuns.saveWorkflowRun(
      WorkflowRun.create({
        id: workflowRunId,
        workspaceId,
        workflowId,
        workflowVersionId: `workflow-version-${label}` as WorkflowVersionId,
        input: {},
        createdAt: NOW,
      }),
    );
    await workflowRuns.saveWorkflowNodeRun(
      WorkflowNodeRun.create({
        id: `node-run-${label}` as WorkflowNodeRunId,
        workspaceId,
        workflowRunId,
        workflowNodeKey: "review",
        sequence: 1,
        input: {},
        createdAt: NOW,
      }),
    );
    return { workflowRunId };
  }
});

interface TimerWaitInsert {
  readonly workflowNodeRunId: WorkflowNodeRunId;
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly armedAt: Date;
  readonly wakeAt: Date;
  readonly resolution?: string;
  readonly resolvedAt?: Date;
  readonly resolvedByEventId?: WorkflowEventId;
}

interface EventWaitInsert {
  readonly workflowNodeRunId: WorkflowNodeRunId;
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly armedAt: Date;
  readonly eligibleFrom: Date;
  readonly expiresAt?: Date;
  readonly resolution?: string;
  readonly resolvedAt?: Date;
  readonly resolvedByEventId?: WorkflowEventId;
}

interface WorkflowEventInsert {
  readonly id: WorkflowEventId;
  readonly workspaceId: WorkspaceId;
  readonly source: string;
  readonly idempotencyKey: string;
  readonly eventType?: string;
  readonly correlationKey?: string;
  readonly payload?: unknown;
  readonly occurredAt?: Date;
  readonly receivedAt?: Date;
}

async function insertTimerWait(
  database: Database,
  values: TimerWaitInsert,
): Promise<void> {
  await database.db.insert(workflowWaits).values({
    workflowNodeRunId: values.workflowNodeRunId,
    workspaceId: values.workspaceId,
    workflowRunId: values.workflowRunId,
    kind: "TIMER",
    armedAt: values.armedAt,
    wakeAt: values.wakeAt,
    resolution: values.resolution ?? null,
    resolvedAt: values.resolvedAt ?? null,
    resolvedByEventId: values.resolvedByEventId ?? null,
  });
}

async function insertEventWait(
  database: Database,
  values: EventWaitInsert,
): Promise<void> {
  await database.db.insert(workflowWaits).values({
    workflowNodeRunId: values.workflowNodeRunId,
    workspaceId: values.workspaceId,
    workflowRunId: values.workflowRunId,
    kind: "EVENT",
    armedAt: values.armedAt,
    eventSource: "billing",
    eventType: "invoice.paid",
    correlationKey: "corr-1",
    eligibleFrom: values.eligibleFrom,
    expiresAt: values.expiresAt ?? null,
    resolution: values.resolution ?? null,
    resolvedAt: values.resolvedAt ?? null,
    resolvedByEventId: values.resolvedByEventId ?? null,
  });
}

async function insertWorkflowEvent(
  database: Database,
  values: WorkflowEventInsert,
): Promise<void> {
  await database.db.insert(workflowEvents).values({
    id: values.id,
    workspaceId: values.workspaceId,
    source: values.source,
    eventType: values.eventType ?? "test.event",
    correlationKey: values.correlationKey ?? "corr-default",
    idempotencyKey: values.idempotencyKey,
    payload: values.payload ?? { ok: true },
    occurredAt: values.occurredAt ?? null,
    receivedAt: values.receivedAt ?? NOW,
  });
}

function timestampMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

async function expectDbViolation(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    throw new Error("Expected database constraint violation.");
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Expected database constraint violation."
    ) {
      throw error;
    }
    const code = postgresErrorCode(error);
    expect(code).toMatch(/^23/);
  }
}
