import { EXECUTION_INTERRUPTED_ERROR_CODE } from "@osva-ai/contracts";
import { Agent, AgentVersion, Run, RunAttempt, Workspace } from "@osva/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresAgentRepository } from "../../src/repositories/postgres-agent-repository.js";
import { PostgresRunRepository } from "../../src/repositories/postgres-run-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { runAttempts } from "../../src/schema/run-attempts.js";
import {
  LATER,
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

describe("PostgreSQL execution lease recovery", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let agents: PostgresAgentRepository;
  let runs: PostgresRunRepository;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    workspaces = new PostgresWorkspaceRepository(database);
    agents = new PostgresAgentRepository(database);
    runs = new PostgresRunRepository(database);
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

  it("acquires, renews, and fails an expired leased RUNNING attempt in place", async () => {
    const seeded = await seedQueuedPending("lease");
    const runningAttempt = seeded.attempt
      .transitionTo("RUNNING", LATER)
      .withExecutionLease({
        owner: "worker-1",
        generation: 1,
        expiresAt: LATER,
      });
    const runningRun = seeded.run.transitionTo("RUNNING", LATER);
    await runs.transitionRunAndAttempt(
      seeded.run.status,
      runningRun,
      seeded.attempt.status,
      runningAttempt,
      { leaseTtlMs: 30_000 },
    );

    const renewed = await runs.renewExecutionLease({
      runAttemptId: seeded.attempt.id,
      owner: "worker-1",
      generation: 1,
      ttlMs: 30_000,
    });
    expect(renewed).toBe(true);

    await database.db
      .update(runAttempts)
      .set({ leaseExpiresAt: new Date(Date.now() - 5_000) })
      .where(eq(runAttempts.id, seeded.attempt.id));

    const expired = await runs.listExpiredLeasedRunningAttempts(10);
    expect(expired.map((attempt) => attempt.id)).toContain(seeded.attempt.id);

    const failed = await runs.failExpiredLeasedAttempt({
      runAttemptId: seeded.attempt.id,
      generation: 1,
      now: new Date(),
      error: {
        code: EXECUTION_INTERRUPTED_ERROR_CODE,
        message: "lease expired",
      },
    });
    expect(failed?.runAttempt.status).toBe("FAILED");
    expect(failed?.runAttempt.error?.code).toBe(
      EXECUTION_INTERRUPTED_ERROR_CODE,
    );
    expect(failed?.run.status).toBe("FAILED");

    const again = await runs.failExpiredLeasedAttempt({
      runAttemptId: seeded.attempt.id,
      generation: 1,
      now: new Date(),
      error: {
        code: EXECUTION_INTERRUPTED_ERROR_CODE,
        message: "lease expired",
      },
    });
    expect(again).toBeNull();
  });

  it("does not list or fail legacy RUNNING rows without leases", async () => {
    const seeded = await seedQueuedPending("legacy");
    await runs.transitionRunAndAttempt(
      seeded.run.status,
      seeded.run.transitionTo("RUNNING", LATER),
      seeded.attempt.status,
      seeded.attempt.transitionTo("RUNNING", LATER),
    );

    expect(await runs.listExpiredLeasedRunningAttempts(10)).toEqual([]);
    expect(
      await runs.failExpiredLeasedAttempt({
        runAttemptId: seeded.attempt.id,
        generation: 0,
        now: new Date(),
        error: {
          code: EXECUTION_INTERRUPTED_ERROR_CODE,
          message: "lease expired",
        },
      }),
    ).toBeNull();
    expect((await runs.findRunAttemptById(seeded.attempt.id))?.status).toBe(
      "RUNNING",
    );
  });

  it("lists QUEUED/PENDING deliveries for transport repair", async () => {
    const seeded = await seedQueuedPending("queued");
    const deliveries = await runs.listQueuedPendingDeliveries(10);
    expect(deliveries.map((delivery) => delivery.runAttempt.id)).toContain(
      seeded.attempt.id,
    );
  });

  it("rejects terminal success after the lease expires", async () => {
    const seeded = await seedQueuedPending("fence");
    const runningAttempt = seeded.attempt
      .transitionTo("RUNNING", LATER)
      .withExecutionLease({
        owner: "worker-1",
        generation: 1,
        expiresAt: LATER,
      });
    await runs.transitionRunAndAttempt(
      seeded.run.status,
      seeded.run.transitionTo("RUNNING", LATER),
      seeded.attempt.status,
      runningAttempt,
      { leaseTtlMs: 1 },
    );
    await database.db
      .update(runAttempts)
      .set({ leaseExpiresAt: new Date(Date.now() - 5_000) })
      .where(eq(runAttempts.id, seeded.attempt.id));

    const current = await runs.findRunAttemptById(seeded.attempt.id);
    const currentRun = await runs.findRunById(seeded.run.id);
    if (current === null || currentRun === null) {
      throw new Error("expected running snapshots");
    }

    await expect(
      runs.transitionRunAndAttempt(
        currentRun.status,
        currentRun.transitionTo("SUCCEEDED", new Date()),
        current.status,
        current.transitionTo("SUCCEEDED", new Date(), { output: { ok: true } }),
      ),
    ).rejects.toThrow();
    expect((await runs.findRunAttemptById(seeded.attempt.id))?.status).toBe(
      "RUNNING",
    );
  });

  it("uses PostgreSQL now() for capability-eligible lease lookup", async () => {
    const seeded = await seedQueuedPending("cap-eligible");
    const runningAttempt = seeded.attempt
      .transitionTo("RUNNING", LATER)
      .withExecutionLease({
        owner: "worker-1",
        generation: 1,
        expiresAt: LATER,
      });
    await runs.transitionRunAndAttempt(
      seeded.run.status,
      seeded.run.transitionTo("RUNNING", LATER),
      seeded.attempt.status,
      runningAttempt,
      { leaseTtlMs: 30_000 },
    );

    expect(
      await runs.findCapabilityEligibleRunAttemptById(seeded.attempt.id),
    ).not.toBeNull();

    await database.db
      .update(runAttempts)
      .set({ leaseExpiresAt: new Date(Date.now() - 5_000) })
      .where(eq(runAttempts.id, seeded.attempt.id));

    expect(
      await runs.findCapabilityEligibleRunAttemptById(seeded.attempt.id),
    ).toBeNull();
    expect((await runs.findRunAttemptById(seeded.attempt.id))?.status).toBe(
      "RUNNING",
    );
  });

  it("keeps legacy unleased RUNNING attempts capability-eligible", async () => {
    const seeded = await seedQueuedPending("cap-legacy");
    await runs.transitionRunAndAttempt(
      seeded.run.status,
      seeded.run.transitionTo("RUNNING", LATER),
      seeded.attempt.status,
      seeded.attempt.transitionTo("RUNNING", LATER),
    );

    expect(
      await runs.findCapabilityEligibleRunAttemptById(seeded.attempt.id),
    ).not.toBeNull();
  });

  async function seedQueuedPending(label: string) {
    const ids = createIds(label);
    await workspaces.save(
      Workspace.create({
        id: ids.workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );
    await agents.saveAgent(
      Agent.create({
        id: ids.agentId,
        workspaceId: ids.workspaceId,
        key: `agent-key-${ids.agentId}`,
        name: "Example Agent",
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
    const run = Run.create({
      id: ids.runId,
      workspaceId: ids.workspaceId,
      agentId: ids.agentId,
      effectiveBindings: createBindings(
        ids.agentVersionId,
        ids.modelProfileVersionId,
      ),
      input: RUN_INPUT,
      createdAt: NOW,
    }).transitionTo("QUEUED", LATER);
    const attempt = RunAttempt.createFirst({
      id: ids.runAttemptId,
      runId: ids.runId,
      createdAt: NOW,
    });
    await runs.createRunWithInitialAttempt(
      Run.create({
        id: ids.runId,
        workspaceId: ids.workspaceId,
        agentId: ids.agentId,
        effectiveBindings: createBindings(
          ids.agentVersionId,
          ids.modelProfileVersionId,
        ),
        input: RUN_INPUT,
        createdAt: NOW,
      }),
      attempt,
    );
    await runs.transitionRun("PENDING", run);
    return {
      run: (await runs.findRunById(ids.runId))!,
      attempt: (await runs.findRunAttemptById(ids.runAttemptId))!,
    };
  }
});
