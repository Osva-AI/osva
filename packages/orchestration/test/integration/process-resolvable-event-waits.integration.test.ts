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
import {
  PostgresWorkflowEventRepository,
  PostgresWorkflowEventWaitResolutionRepository,
  PostgresWorkflowRepository,
  PostgresWorkflowRunRepository,
  PostgresWorkflowWaitRepository,
  PostgresWorkspaceRepository,
  createDatabase,
  migrateDatabase,
  type Database,
} from "@osva/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ProcessResolvableEventWaits } from "../../src/process-resolvable-event-waits.js";
import { createIds, NOW } from "../../../db/test/integration/fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "../../../db/test/integration/postgres-harness.js";

const RUN_CREATED = new Date("2026-01-01T10:00:00.000Z");
const ARMED = new Date("2026-01-01T10:05:00.000Z");
const TIMEOUT_MS = 55 * 60_000;

describe("ProcessResolvableEventWaits PostgreSQL integration", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let workflows: PostgresWorkflowRepository;
  let workflowRuns: PostgresWorkflowRunRepository;
  let waits: PostgresWorkflowWaitRepository;
  let events: PostgresWorkflowEventRepository;
  let resolution: PostgresWorkflowEventWaitResolutionRepository;
  let processor: ProcessResolvableEventWaits;

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
    processor = new ProcessResolvableEventWaits({
      workflowWaits: waits,
      eventWaitResolution: resolution,
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

  it("recovers scenario F without ingest matching", async () => {
    const seeded = await seedGraph("scenario-f");
    await waits.saveWorkflowWait(armEvent(seeded));
    await events.saveWorkflowEvent(
      WorkflowEvent.create({
        id: "evt-f" as WorkflowEventId,
        workspaceId: seeded.workspaceId,
        source: "payments",
        eventType: "payment.completed",
        correlationKey: "ord-1",
        idempotencyKey: "idem-f",
        payload: {},
        receivedAt: new Date("2026-01-01T10:30:00.000Z"),
      }),
    );

    const resolved = await processor.execute(
      new Date("2026-01-01T11:30:00.000Z"),
      10,
    );
    expect(resolved[0]!.resolution).toBe("EVENT");
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
