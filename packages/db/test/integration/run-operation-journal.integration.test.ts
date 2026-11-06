import { Agent, AgentVersion, Run, RunAttempt, Workspace } from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresAgentRepository } from "../../src/repositories/postgres-agent-repository.js";
import { PostgresRunOperationJournalRepository } from "../../src/repositories/postgres-run-operation-journal-repository.js";
import { PostgresRunRepository } from "../../src/repositories/postgres-run-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import {
  NOW,
  RUN_INPUT,
  createBindings,
  createIds,
  createManifest,
} from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

describe("PostgreSQL run operation journal", () => {
  let context: PostgresTestContext;
  let database: Database;
  let journal: PostgresRunOperationJournalRepository;
  let runs: PostgresRunRepository;
  let workspaces: PostgresWorkspaceRepository;
  let agents: PostgresAgentRepository;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    journal = new PostgresRunOperationJournalRepository(database);
    runs = new PostgresRunRepository(database);
    workspaces = new PostgresWorkspaceRepository(database);
    agents = new PostgresAgentRepository(database);
  });

  afterAll(async () => {
    await database.close();
    await stopPostgresForTests(context);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
  });

  it("records pending operations idempotently and commits results", async () => {
    const ids = createIds("journal-op");
    await workspaces.save(
      Workspace.create({
        id: ids.workspaceId,
        name: "ws",
        createdAt: NOW,
      }),
    );
    await agents.saveAgent(
      Agent.create({
        id: ids.agentId,
        workspaceId: ids.workspaceId,
        key: `agent-${ids.agentId}`,
        name: "Agent",
        createdAt: NOW,
      }),
    );
    await agents.saveAgentVersion(
      AgentVersion.create({
        id: ids.agentVersionId,
        agentId: ids.agentId,
        version: 1,
        manifest: createManifest(),
        createdAt: NOW,
      }),
    );
    const bindings = createBindings(
      ids.agentVersionId,
      ids.modelProfileVersionId,
    );
    await runs.createRunWithInitialAttempt(
      Run.create({
        id: ids.runId,
        workspaceId: ids.workspaceId,
        agentId: ids.agentId,
        effectiveBindings: bindings,
        input: RUN_INPUT,
        createdAt: NOW,
      }),
      RunAttempt.createFirst({
        id: ids.runAttemptId,
        runId: ids.runId,
        createdAt: NOW,
      }),
    );

    const pending = await journal.recordPending({
      workspaceId: ids.workspaceId,
      runId: ids.runId,
      runAttemptId: ids.runAttemptId,
      executionGeneration: 1,
      operationKey: `${ids.runId}:call-1`,
      toolVersionId:
        `tool-v-${ids.runId}` as import("@osva-ai/contracts").ToolVersionId,
      bindingName: "echo",
      inputFingerprint: "fp",
      idempotencyClass: "PURE",
    });
    const duplicate = await journal.recordPending({
      workspaceId: ids.workspaceId,
      runId: ids.runId,
      runAttemptId: ids.runAttemptId,
      executionGeneration: 1,
      operationKey: `${ids.runId}:call-1`,
      toolVersionId:
        `tool-v-${ids.runId}` as import("@osva-ai/contracts").ToolVersionId,
      bindingName: "echo",
      inputFingerprint: "fp",
      idempotencyClass: "PURE",
    });
    expect(duplicate.id).toBe(pending.id);

    const committed = await journal.commitResult({
      workspaceId: ids.workspaceId,
      runId: ids.runId,
      operationKey: `${ids.runId}:call-1`,
      committedResult: { ok: true },
    });
    expect(committed?.status).toBe("COMMITTED");
  });
});
