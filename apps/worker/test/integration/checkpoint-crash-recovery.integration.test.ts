import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RunAttemptId, RunId, WorkspaceId } from "@osva-ai/contracts";
import {
  createDatabase,
  migrateDatabase,
  PostgresRunCheckpointRepository,
  PostgresRunOperationJournalRepository,
  PostgresRunRepository,
  type Database,
} from "@osva/db";
import { bootstrapIntegrationAuth } from "./integration-auth.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "../../../../packages/db/test/integration/postgres-harness.js";
import {
  startValkeyForTests,
  stopValkeyForTests,
  type ValkeyTestContext,
} from "../../../../adapters/bullmq/test/integration/valkey-harness.js";
import {
  createCheckpointRun,
  expectCrashExit,
  interruptAndRecover,
  readCounters,
  seedCheckpointCrashFixture,
  spawnCheckpointCrashExec,
  tempCountersPath,
} from "./checkpoint-crash-harness.js";

const WORKSPACE_ID = "ws-checkpoint-crash" as WorkspaceId;
const RUN_ID = "run-checkpoint-crash-1" as RunId;
const ATTEMPT_ID = "run-attempt-checkpoint-crash-1" as RunAttemptId;

describe("checkpoint crash recovery (process-level)", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;
  let fixture: Awaited<ReturnType<typeof seedCheckpointCrashFixture>>;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 8,
      connectTimeoutSeconds: 15,
    });
    await migrateDatabase(database);
  }, 180_000);

  afterAll(async () => {
    await database.close();
    await stopPostgresForTests(postgres);
    await stopValkeyForTests(valkey);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await bootstrapIntegrationAuth(database, WORKSPACE_ID, new Date());
    fixture = await seedCheckpointCrashFixture(database, WORKSPACE_ID);
    await createCheckpointRun({
      database,
      valkeyUrl: valkey.url,
      fixture,
      runId: RUN_ID,
      runAttemptId: ATTEMPT_ID,
    });
  }, 120_000);

  it("scenario 3: crash during model invocation, recover in a new process", async () => {
    const countersPath = await tempCountersPath();
    const crash = spawnCheckpointCrashExec({
      databaseUrl: postgres.connectionString,
      runAttemptId: ATTEMPT_ID,
      crashPhase: "during_model_invocation",
      scenario: "model_then_answer",
      countersPath,
      owner: "crash-worker-a",
    });
    expectCrashExit(crash, crash);
    const crashCounters = await readCounters(countersPath);
    expect(crashCounters.modelInvocations).toBe(1);
    expect(crashCounters.toolInvocations).toBe(0);

    const checkpoints = new PostgresRunCheckpointRepository(database);
    const latest = await checkpoints.findLatestByRun(WORKSPACE_ID, RUN_ID);
    expect(latest?.cursor.phase).toBe("after_prefetch");

    const successorId = await interruptAndRecover({
      database,
      valkeyUrl: valkey.url,
      runId: RUN_ID,
      leaseExpiredAt: new Date(),
    });
    expect(successorId).not.toBeNull();

    const countersPath2 = await tempCountersPath();
    const recover = spawnCheckpointCrashExec({
      databaseUrl: postgres.connectionString,
      runAttemptId: successorId!,
      scenario: "model_then_answer",
      countersPath: countersPath2,
      owner: "crash-worker-b",
    });
    expect(recover.exitCode).toBe(0);

    const runs = new PostgresRunRepository(database);
    expect((await runs.findRunById(RUN_ID))?.status).toBe("SUCCEEDED");
    const totalModel =
      crashCounters.modelInvocations +
      (await readCounters(countersPath2)).modelInvocations;
    expect(totalModel).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it("scenario 4: crash after operation pending, before external dispatch", async () => {
    const countersPath = await tempCountersPath();
    const crash = spawnCheckpointCrashExec({
      databaseUrl: postgres.connectionString,
      runAttemptId: ATTEMPT_ID,
      crashPhase: "after_operation_pending",
      scenario: "tool_flow",
      countersPath,
      owner: "crash-worker-a",
      toolClass: "READ_ONLY",
    });
    expectCrashExit(crash, crash);
    const crashCounters = await readCounters(countersPath);
    expect(crashCounters.toolInvocations).toBe(0);

    const journal = new PostgresRunOperationJournalRepository(database);
    const entry = await journal.findByRunAndOperationKey(
      WORKSPACE_ID,
      RUN_ID,
      `${RUN_ID}:call-echo-1`,
    );
    expect(entry?.status).toBe("PENDING");

    const successorId = await interruptAndRecover({
      database,
      valkeyUrl: valkey.url,
      runId: RUN_ID,
      leaseExpiredAt: new Date(),
    });
    expect(successorId).not.toBeNull();

    const countersPath2 = await tempCountersPath();
    const recover = spawnCheckpointCrashExec({
      databaseUrl: postgres.connectionString,
      runAttemptId: successorId!,
      scenario: "tool_flow",
      countersPath: countersPath2,
      owner: "crash-worker-b",
      toolVersionId: fixture.toolVersionId,
      toolClass: "READ_ONLY",
    });
    expect(recover.exitCode).toBe(0);
    const recoverCounters = await readCounters(countersPath2);
    expect(recoverCounters.toolInvocations).toBe(1);
    expect(entry?.id).toBe(
      (
        await journal.findByRunAndOperationKey(
          WORKSPACE_ID,
          RUN_ID,
          `${RUN_ID}:call-echo-1`,
        )
      )?.id,
    );
  }, 120_000);

  it("scenario 6: crash after journal commit, before tool checkpoint", async () => {
    const countersPath = await tempCountersPath();
    const crash = spawnCheckpointCrashExec({
      databaseUrl: postgres.connectionString,
      runAttemptId: ATTEMPT_ID,
      crashPhase: "after_tool_journal_commit",
      scenario: "tool_flow",
      countersPath,
      owner: "crash-worker-a",
    });
    expectCrashExit(crash, crash);
    expect((await readCounters(countersPath)).toolInvocations).toBe(1);

    const journal = new PostgresRunOperationJournalRepository(database);
    const committed = await journal.findByRunAndOperationKey(
      WORKSPACE_ID,
      RUN_ID,
      `${RUN_ID}:call-echo-1`,
    );
    expect(committed?.status).toBe("COMMITTED");

    const successorId = await interruptAndRecover({
      database,
      valkeyUrl: valkey.url,
      runId: RUN_ID,
      leaseExpiredAt: new Date(),
    });
    expect(successorId).not.toBeNull();

    const countersPath2 = await tempCountersPath();
    const recover = spawnCheckpointCrashExec({
      databaseUrl: postgres.connectionString,
      runAttemptId: successorId!,
      scenario: "tool_flow",
      countersPath: countersPath2,
      owner: "crash-worker-b",
      toolVersionId: fixture.toolVersionId,
    });
    expect(recover.exitCode).toBe(0);
    expect((await readCounters(countersPath2)).toolInvocations).toBe(0);
  }, 120_000);

  it("scenario 7: crash after tool checkpoint, resume without repeating tool", async () => {
    const countersPath = await tempCountersPath();
    const crash = spawnCheckpointCrashExec({
      databaseUrl: postgres.connectionString,
      runAttemptId: ATTEMPT_ID,
      crashPhase: "after_tool_checkpoint",
      scenario: "tool_flow",
      countersPath,
      owner: "crash-worker-a",
    });
    expectCrashExit(crash, crash);
    expect((await readCounters(countersPath)).toolInvocations).toBe(1);

    const checkpoints = new PostgresRunCheckpointRepository(database);
    const latest = await checkpoints.findLatestByRun(WORKSPACE_ID, RUN_ID);
    expect(latest?.cursor.phase).toBe("after_tool");

    const successorId = await interruptAndRecover({
      database,
      valkeyUrl: valkey.url,
      runId: RUN_ID,
      leaseExpiredAt: new Date(),
    });
    expect(successorId).not.toBeNull();

    const countersPath2 = await tempCountersPath();
    const recover = spawnCheckpointCrashExec({
      databaseUrl: postgres.connectionString,
      runAttemptId: successorId!,
      scenario: "tool_flow",
      countersPath: countersPath2,
      owner: "crash-worker-b",
      toolVersionId: fixture.toolVersionId,
    });
    expect(recover.exitCode).toBe(0);
    expect((await readCounters(countersPath2)).toolInvocations).toBe(0);
    const runs = new PostgresRunRepository(database);
    expect((await runs.findRunById(RUN_ID))?.status).toBe("SUCCEEDED");
  }, 120_000);
});
