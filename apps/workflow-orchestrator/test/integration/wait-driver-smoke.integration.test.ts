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
  PostgresWorkflowWaitRepository,
  PostgresWorkspaceRepository,
  createDatabase,
  migrateDatabase,
  type Database,
} from "@osva/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createWorkflowOrchestratorProcess } from "../../src/process.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "../../../../packages/db/test/integration/postgres-harness.js";
import {
  startValkeyForTests,
  stopValkeyForTests,
} from "../../../../adapters/bullmq/test/integration/valkey-harness.js";

const WORKSPACE_ID = "ws-wait-driver-smoke" as WorkspaceId;
const RUN_CREATED = new Date("2026-01-01T09:00:00.000Z");
const ARMED = new Date("2026-01-01T10:00:00.000Z");
const DUE = new Date("2026-01-01T10:05:00.000Z");

describe("workflow orchestrator wait driver smoke", () => {
  let postgres: PostgresTestContext;
  let valkey: Awaited<ReturnType<typeof startValkeyForTests>>;
  let database: Database;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
    if (postgres) {
      await stopPostgresForTests(postgres);
    }
    if (valkey) {
      await stopValkeyForTests(valkey);
    }
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await new PostgresWorkspaceRepository(database).save(
      Workspace.create({
        id: WORKSPACE_ID,
        name: "Workspace",
        createdAt: RUN_CREATED,
      }),
    );
  });

  it("resolves a due TIMER wait during tickOnce without progressing WorkflowRuns", async () => {
    const seeded = await seedActiveWorkflowRun(database);
    const waits = new PostgresWorkflowWaitRepository(database);
    await waits.saveWorkflowWait(
      armWorkflowWait({
        workspaceId: WORKSPACE_ID,
        workflowRunId: seeded.workflowRunId,
        workflowNodeRunId: seeded.workflowNodeRunId,
        workflowRunCreatedAt: RUN_CREATED,
        wait: { kind: "DURATION", durationMs: 60_000 },
        nodeInput: {},
        armedAt: ARMED,
      }),
    );

    const orchestrator = createWorkflowOrchestratorProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WORKFLOW_ORCHESTRATOR_POLL_MS: "60000",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      { clock: { now: () => DUE } },
    );

    await orchestrator.tickOnce();

    const stored = await waits.findWorkflowWaitByWorkflowNodeRunId(
      seeded.workflowNodeRunId,
    );
    expect(stored?.resolution).toBe("TIMER");
  });
});

async function seedActiveWorkflowRun(database: Database) {
  const workflows = new PostgresWorkflowRepository(database);
  const workflowRuns = new PostgresWorkflowRunRepository(database);
  const workflowId = "wf-smoke" as WorkflowId;
  const workflowVersionId = "wv-smoke" as WorkflowVersionId;
  const workflowRunId = "wr-smoke" as WorkflowRunId;
  const workflowNodeRunId = "wnr-smoke" as WorkflowNodeRunId;

  await workflows.saveWorkflow(
    Workflow.create({
      id: workflowId,
      workspaceId: WORKSPACE_ID,
      key: "smoke",
      name: "Smoke",
      createdAt: RUN_CREATED,
      updatedAt: RUN_CREATED,
    }),
  );
  await workflows.saveWorkflowVersion(
    WorkflowVersion.create({
      id: workflowVersionId,
      workflowId,
      workspaceId: WORKSPACE_ID,
      version: 1,
      definition: {
        schemaVersion: "2",
        nodes: [{ key: "review", type: "APPROVAL", title: "Review" }],
        edges: [],
      },
      createdAt: RUN_CREATED,
    }),
  );
  await workflowRuns.saveWorkflowRun(
    WorkflowRun.create({
      id: workflowRunId,
      workspaceId: WORKSPACE_ID,
      workflowId,
      workflowVersionId,
      input: {},
      createdAt: RUN_CREATED,
    }).markRunning(ARMED),
  );
  await workflowRuns.saveWorkflowNodeRun(
    WorkflowNodeRun.create({
      id: workflowNodeRunId,
      workspaceId: WORKSPACE_ID,
      workflowRunId,
      workflowNodeKey: "review",
      sequence: 1,
      input: {},
      createdAt: ARMED,
    }),
  );

  return { workflowRunId, workflowNodeRunId };
}
