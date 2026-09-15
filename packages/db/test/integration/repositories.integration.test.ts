import type { AgentVersionId, RunAttemptId, RunId } from "@osva/contracts";
import {
  Agent,
  AgentNotFoundError,
  AgentVersion,
  DomainInvariantError,
  DuplicateAgentKeyError,
  InvalidRunAttemptTransitionError,
  InvalidRunTransitionError,
  LifecycleConflictError,
  Run,
  RunAttempt,
  RunNotFoundError,
  RunStep,
  Workspace,
} from "@osva/domain";
import type {
  AgentRepository,
  RunRepository,
  WorkspaceRepository,
} from "@osva/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { runStepFromRow } from "../../src/mappers/run-step-mapper.js";
import { migrateDatabase } from "../../src/migrate.js";
import {
  POSTGRES_FOREIGN_KEY_VIOLATION,
  postgresErrorCode,
} from "../../src/postgres-errors.js";
import { PostgresAgentRepository } from "../../src/repositories/postgres-agent-repository.js";
import { PostgresRunRepository } from "../../src/repositories/postgres-run-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { deployments } from "../../src/schema/deployments.js";
import { runSteps } from "../../src/schema/run-steps.js";
import {
  EVEN_LATER,
  LATER,
  NOW,
  createBindings,
  createIds,
  createManifest,
  RUN_INPUT,
} from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

describe("PostgreSQL Stage 0 repositories", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: WorkspaceRepository;
  let agents: AgentRepository;
  let runs: RunRepository;
  let idCounter = 0;

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

  function nextIds() {
    idCounter += 1;
    return createIds(String(idCounter));
  }

  async function seedAgentGraph(label?: string) {
    const ids = label ? createIds(label) : nextIds();
    const workspace = Workspace.create({
      id: ids.workspaceId,
      name: "Workspace",
      createdAt: NOW,
    });
    const agent = Agent.create({
      id: ids.agentId,
      workspaceId: ids.workspaceId,
      key: `agent-key-${ids.agentId}`,
      name: "Example Agent",
      createdAt: NOW,
    });
    const version = AgentVersion.create({
      id: ids.agentVersionId,
      agentId: ids.agentId,
      version: 1,
      manifest: createManifest(),
      createdAt: NOW,
    });

    await workspaces.save(workspace);
    await agents.saveAgent(agent);
    await agents.saveAgentVersion(version);

    return { ids, workspace, agent, version };
  }

  describe("Workspace", () => {
    it("saves and loads a Workspace", async () => {
      const ids = nextIds();
      const workspace = Workspace.create({
        id: ids.workspaceId,
        name: "Acme",
        createdAt: NOW,
      });

      await workspaces.save(workspace);

      const loaded = await workspaces.findById(ids.workspaceId);
      expect(loaded).toEqual(workspace);
      expect(loaded?.createdAt).toEqual(NOW);
      expect(Object.isFrozen(loaded)).toBe(true);
    });
  });

  describe("Agent", () => {
    it("saves and loads an Agent", async () => {
      const { ids, agent } = await seedAgentGraph();

      const loaded = await agents.findAgentById(ids.agentId);
      expect(loaded).toEqual(agent);
      expect(loaded?.workspaceId).toBe(ids.workspaceId);
      expect(Object.isFrozen(loaded)).toBe(true);
    });

    it("rejects a duplicate workspace/key pair", async () => {
      const { ids } = await seedAgentGraph();

      await expect(
        agents.saveAgent(
          Agent.create({
            id: ids.otherAgentId,
            workspaceId: ids.workspaceId,
            key: `agent-key-${ids.agentId}`,
            name: "Duplicate Key",
            createdAt: NOW,
          }),
        ),
      ).rejects.toBeInstanceOf(DuplicateAgentKeyError);
    });

    it("lists Agents in createdAt then id order", async () => {
      const first = await seedAgentGraph("list-a");
      const second = await seedAgentGraph("list-b");

      await agents.updateAgentMetadata(first.ids.agentId, {
        name: "First Agent",
      });

      const listed = await agents.listAgents();
      expect(listed.map((agent) => agent.id)).toEqual([
        first.ids.agentId,
        second.ids.agentId,
      ]);
      expect(listed[0]?.name).toBe("First Agent");
    });

    it("updates Agent name without changing identity fields", async () => {
      const { ids, agent } = await seedAgentGraph();

      const updated = await agents.updateAgentMetadata(ids.agentId, {
        name: "Renamed Agent",
      });

      expect(updated?.name).toBe("Renamed Agent");
      expect(updated?.id).toBe(agent.id);
      expect(updated?.key).toBe(agent.key);
      expect(updated?.workspaceId).toBe(agent.workspaceId);
      expect(updated?.createdAt).toEqual(agent.createdAt);
      expect(
        await agents.updateAgentMetadata(ids.otherAgentId, { name: "X" }),
      ).toBeNull();
    });
  });

  describe("AgentVersion", () => {
    it("saves and loads an AgentVersion including the manifest", async () => {
      const { ids, version } = await seedAgentGraph();

      const loaded = await agents.findAgentVersionById(ids.agentVersionId);
      expect(loaded?.id).toBe(version.id);
      expect(loaded?.agentId).toBe(version.agentId);
      expect(loaded?.version).toBe(1);
      expect(loaded?.manifest).toEqual(createManifest());
      expect(loaded?.createdAt).toEqual(NOW);
      expect(Object.isFrozen(loaded)).toBe(true);
      expect(Object.isFrozen(loaded?.manifest)).toBe(true);
    });

    it("treats saving the same immutable AgentVersion as idempotent", async () => {
      const { ids } = await seedAgentGraph();
      const equivalent = AgentVersion.create({
        id: ids.agentVersionId,
        agentId: ids.agentId,
        version: 1,
        manifest: createManifest({
          runtime: { type: "BUILTIN_PACKAGE", key: "example-agent" },
        }),
        createdAt: NOW,
      });

      await agents.saveAgentVersion(equivalent);
      const loaded = await agents.findAgentVersionById(ids.agentVersionId);
      expect(loaded?.manifest.name).toBe("Example Agent");
    });

    it("rejects replacing an AgentVersion with different content", async () => {
      const { ids } = await seedAgentGraph();

      await expect(
        agents.saveAgentVersion(
          AgentVersion.create({
            id: ids.agentVersionId,
            agentId: ids.agentId,
            version: 1,
            manifest: createManifest({ name: "Changed Agent" }),
            createdAt: NOW,
          }),
        ),
      ).rejects.toBeInstanceOf(DomainInvariantError);

      const stored = await agents.findAgentVersionById(ids.agentVersionId);
      expect(stored?.manifest.name).toBe("Example Agent");
    });

    it("rejects a second AgentVersion with the same agentId and version", async () => {
      const { ids } = await seedAgentGraph();

      await expect(
        agents.saveAgentVersion(
          AgentVersion.create({
            id: ids.otherAgentVersionId,
            agentId: ids.agentId,
            version: 1,
            manifest: createManifest({ name: "Other Snapshot" }),
            createdAt: NOW,
          }),
        ),
      ).rejects.toBeInstanceOf(DomainInvariantError);
    });

    it("appends monotonically increasing versions per Agent", async () => {
      const { ids } = await seedAgentGraph();

      const second = await agents.appendAgentVersion({
        id: ids.otherAgentVersionId,
        agentId: ids.agentId,
        manifest: createManifest({ name: "Second Snapshot" }),
        createdAt: LATER,
      });

      expect(second.version).toBe(2);
      expect(second.manifest.name).toBe("Second Snapshot");

      const listed = await agents.listAgentVersions(ids.agentId);
      expect(listed.map((version) => version.version)).toEqual([1, 2]);
      expect(listed.map((version) => version.id)).toEqual([
        ids.agentVersionId,
        ids.otherAgentVersionId,
      ]);
    });

    it("numbers versions independently per Agent", async () => {
      const first = await seedAgentGraph("num-a");
      const second = await seedAgentGraph("num-b");

      const firstSecond = await agents.appendAgentVersion({
        id: first.ids.otherAgentVersionId,
        agentId: first.ids.agentId,
        manifest: createManifest({ name: "A2" }),
        createdAt: LATER,
      });
      const secondFirst = await agents.findAgentVersionById(
        second.ids.agentVersionId,
      );

      expect(firstSecond.version).toBe(2);
      expect(secondFirst?.version).toBe(1);
    });

    it("does not expose an AgentVersion mutation operation", () => {
      expect(agents).not.toHaveProperty("updateAgentVersion");
    });

    it("rejects appending a version for a nonexistent Agent", async () => {
      const ids = nextIds();

      await expect(
        agents.appendAgentVersion({
          id: ids.agentVersionId,
          agentId: ids.agentId,
          manifest: createManifest(),
          createdAt: NOW,
        }),
      ).rejects.toBeInstanceOf(AgentNotFoundError);
    });
  });

  describe("Run", () => {
    it("saves and loads a Run, including bindings and a null idempotency key", async () => {
      const { ids } = await seedAgentGraph();
      const bindings = createBindings(
        ids.agentVersionId,
        ids.modelProfileVersionId,
      );
      const run = Run.create({
        input: RUN_INPUT,
        id: ids.runId,
        workspaceId: ids.workspaceId,
        agentId: ids.agentId,
        effectiveBindings: bindings,
        createdAt: NOW,
      });

      await runs.saveRun(run);

      const loaded = await runs.findRunById(ids.runId);
      expect(loaded?.status).toBe("PENDING");
      expect(loaded?.idempotencyKey).toBeUndefined();
      expect(loaded?.effectiveBindings.agentVersionId).toBe(ids.agentVersionId);
      expect(loaded?.effectiveBindings.modelProfileVersionBindings).toEqual(
        bindings.modelProfileVersionBindings,
      );
      expect(loaded?.createdAt).toEqual(NOW);
      expect(loaded?.updatedAt).toEqual(NOW);
      expect(loaded?.input).toEqual(RUN_INPUT);
      expect(Object.isFrozen(loaded)).toBe(true);
    });

    it("replaces a Run with a later valid domain snapshot", async () => {
      const { ids } = await seedAgentGraph();
      const pending = Run.create({
        input: RUN_INPUT,
        id: ids.runId,
        workspaceId: ids.workspaceId,
        agentId: ids.agentId,
        effectiveBindings: createBindings(
          ids.agentVersionId,
          ids.modelProfileVersionId,
        ),
        createdAt: NOW,
        idempotencyKey: "create-invoice",
      });
      await runs.saveRun(pending);

      const queued = pending.transitionTo("QUEUED", LATER);
      await runs.transitionRun("PENDING", queued);

      const stored = await runs.findRunById(ids.runId);
      expect(stored?.status).toBe("QUEUED");
      expect(stored?.updatedAt).toEqual(LATER);
      expect(stored?.createdAt).toEqual(NOW);
      expect(stored?.idempotencyKey).toBe("create-invoice");
    });

    it("round-trips the effective AgentVersion id and model profile binding map", async () => {
      const { ids } = await seedAgentGraph();
      const bindings = createBindings(
        ids.agentVersionId,
        ids.modelProfileVersionId,
      );
      await runs.saveRun(
        Run.create({
          input: RUN_INPUT,
          id: ids.runId,
          workspaceId: ids.workspaceId,
          agentId: ids.agentId,
          effectiveBindings: bindings,
          createdAt: NOW,
        }),
      );

      const loaded = await runs.findRunById(ids.runId);
      expect(loaded?.effectiveBindings.agentVersionId).toBe(
        ids.agentVersionId as AgentVersionId,
      );
      expect(loaded?.effectiveBindings.modelProfileVersionBindings).toEqual({
        default: ids.modelProfileVersionId,
        "tool.summarize": `${ids.modelProfileVersionId}_secondary`,
      });
    });

    it("allows two Runs in the same workspace when idempotency keys are null", async () => {
      const { ids } = await seedAgentGraph();
      const bindings = createBindings(
        ids.agentVersionId,
        ids.modelProfileVersionId,
      );

      await runs.saveRun(
        Run.create({
          input: RUN_INPUT,
          id: ids.runId,
          workspaceId: ids.workspaceId,
          agentId: ids.agentId,
          effectiveBindings: bindings,
          createdAt: NOW,
        }),
      );
      await runs.saveRun(
        Run.create({
          input: RUN_INPUT,
          id: ids.otherRunId,
          workspaceId: ids.workspaceId,
          agentId: ids.agentId,
          effectiveBindings: bindings,
          createdAt: NOW,
        }),
      );

      await expect(runs.findRunById(ids.runId)).resolves.not.toBeNull();
      await expect(runs.findRunById(ids.otherRunId)).resolves.not.toBeNull();
    });

    it("rejects a duplicate non-null workspace/idempotency key pair", async () => {
      const { ids } = await seedAgentGraph();
      const bindings = createBindings(
        ids.agentVersionId,
        ids.modelProfileVersionId,
      );

      await runs.saveRun(
        Run.create({
          input: RUN_INPUT,
          id: ids.runId,
          workspaceId: ids.workspaceId,
          agentId: ids.agentId,
          effectiveBindings: bindings,
          createdAt: NOW,
          idempotencyKey: "shared-key",
        }),
      );

      await expect(
        runs.saveRun(
          Run.create({
            input: RUN_INPUT,
            id: ids.otherRunId,
            workspaceId: ids.workspaceId,
            agentId: ids.agentId,
            effectiveBindings: bindings,
            createdAt: NOW,
            idempotencyKey: "shared-key",
          }),
        ),
      ).rejects.toBeInstanceOf(DomainInvariantError);
    });
  });

  describe("RunAttempt", () => {
    it("saves and loads a RunAttempt including state, timestamps, error, and metadata", async () => {
      const { ids } = await seedAgentGraph();
      await runs.saveRun(
        Run.create({
          input: RUN_INPUT,
          id: ids.runId,
          workspaceId: ids.workspaceId,
          agentId: ids.agentId,
          effectiveBindings: createBindings(
            ids.agentVersionId,
            ids.modelProfileVersionId,
          ),
          createdAt: NOW,
        }),
      );

      const pending = RunAttempt.createFirst({
        id: ids.runAttemptId,
        runId: ids.runId,
        createdAt: NOW,
        infrastructureMetadata: { worker: "exec-1", attemptToken: 7 },
      });
      const failed = pending
        .transitionTo("RUNNING", LATER)
        .transitionTo("FAILED", EVEN_LATER, {
          error: { code: "RUNTIME", message: "boom" },
          infrastructureMetadata: { worker: "exec-1", exit: 1 },
        });

      await runs.saveRunAttempt(failed);

      const loaded = await runs.findRunAttemptById(ids.runAttemptId);
      expect(loaded?.id).toBe(ids.runAttemptId);
      expect(loaded?.runId).toBe(ids.runId);
      expect(loaded?.sequence).toBe(1);
      expect(loaded?.status).toBe("FAILED");
      expect(loaded?.createdAt).toEqual(NOW);
      expect(loaded?.startedAt).toEqual(LATER);
      expect(loaded?.completedAt).toEqual(EVEN_LATER);
      expect(loaded?.error).toEqual({ code: "RUNTIME", message: "boom" });
      expect(loaded?.infrastructureMetadata).toEqual({
        worker: "exec-1",
        exit: 1,
      });
      expect(Object.isFrozen(loaded)).toBe(true);
    });

    it("lists attempts for one Run in ascending sequence without leaking others", async () => {
      const { ids } = await seedAgentGraph();
      await runs.saveRun(
        Run.create({
          input: RUN_INPUT,
          id: ids.runId,
          workspaceId: ids.workspaceId,
          agentId: ids.agentId,
          effectiveBindings: createBindings(
            ids.agentVersionId,
            ids.modelProfileVersionId,
          ),
          createdAt: NOW,
        }),
      );
      await runs.saveRun(
        Run.create({
          input: RUN_INPUT,
          id: ids.otherRunId,
          workspaceId: ids.workspaceId,
          agentId: ids.agentId,
          effectiveBindings: createBindings(
            ids.agentVersionId,
            ids.modelProfileVersionId,
          ),
          createdAt: NOW,
        }),
      );

      const first = RunAttempt.createFirst({
        id: ids.runAttemptId,
        runId: ids.runId,
        createdAt: NOW,
      });
      const second = RunAttempt.createSubsequent(
        first.transitionTo("RUNNING", LATER).transitionTo("FAILED", LATER),
        { id: ids.secondAttemptId, createdAt: LATER },
      );
      const other = RunAttempt.createFirst({
        id: ids.otherAttemptId,
        runId: ids.otherRunId,
        createdAt: NOW,
      });

      await runs.saveRunAttempt(second);
      await runs.saveRunAttempt(other);
      await runs.saveRunAttempt(first);

      const listed = await runs.listRunAttempts(ids.runId);
      expect(listed.map((attempt) => attempt.id)).toEqual([
        ids.runAttemptId,
        ids.secondAttemptId,
      ]);
      expect(listed.map((attempt) => attempt.sequence)).toEqual([1, 2]);

      const otherListed = await runs.listRunAttempts(ids.otherRunId);
      expect(otherListed.map((attempt) => attempt.id)).toEqual([
        ids.otherAttemptId,
      ]);
    });

    it("rejects a duplicate sequence within one Run", async () => {
      const { ids } = await seedAgentGraph();
      await runs.saveRun(
        Run.create({
          input: RUN_INPUT,
          id: ids.runId,
          workspaceId: ids.workspaceId,
          agentId: ids.agentId,
          effectiveBindings: createBindings(
            ids.agentVersionId,
            ids.modelProfileVersionId,
          ),
          createdAt: NOW,
        }),
      );
      await runs.saveRunAttempt(
        RunAttempt.createFirst({
          id: ids.runAttemptId,
          runId: ids.runId,
          createdAt: NOW,
        }),
      );

      await expect(
        runs.saveRunAttempt(
          RunAttempt.rehydrate({
            id: ids.secondAttemptId,
            runId: ids.runId,
            sequence: 1,
            status: "PENDING",
            createdAt: NOW,
          }),
        ),
      ).rejects.toBeInstanceOf(DomainInvariantError);
    });

    it("allows the same sequence number on different Runs", async () => {
      const { ids } = await seedAgentGraph();
      const bindings = createBindings(
        ids.agentVersionId,
        ids.modelProfileVersionId,
      );
      await runs.saveRun(
        Run.create({
          input: RUN_INPUT,
          id: ids.runId,
          workspaceId: ids.workspaceId,
          agentId: ids.agentId,
          effectiveBindings: bindings,
          createdAt: NOW,
        }),
      );
      await runs.saveRun(
        Run.create({
          input: RUN_INPUT,
          id: ids.otherRunId,
          workspaceId: ids.workspaceId,
          agentId: ids.agentId,
          effectiveBindings: bindings,
          createdAt: NOW,
        }),
      );

      await runs.saveRunAttempt(
        RunAttempt.createFirst({
          id: ids.runAttemptId,
          runId: ids.runId,
          createdAt: NOW,
        }),
      );
      await runs.saveRunAttempt(
        RunAttempt.createFirst({
          id: ids.otherAttemptId,
          runId: ids.otherRunId,
          createdAt: NOW,
        }),
      );

      const first = await runs.findRunAttemptById(ids.runAttemptId);
      const second = await runs.findRunAttemptById(ids.otherAttemptId);
      expect(first?.sequence).toBe(1);
      expect(second?.sequence).toBe(1);
      expect(first?.runId).toBe(ids.runId as RunId);
      expect(second?.runId).toBe(ids.otherRunId as RunId);
    });
  });

  describe("RunStep", () => {
    it("saves a RunStep that retains Run and RunAttempt identity", async () => {
      const { ids } = await seedAgentGraph();
      await runs.saveRun(
        Run.create({
          input: RUN_INPUT,
          id: ids.runId,
          workspaceId: ids.workspaceId,
          agentId: ids.agentId,
          effectiveBindings: createBindings(
            ids.agentVersionId,
            ids.modelProfileVersionId,
          ),
          createdAt: NOW,
        }),
      );
      await runs.saveRunAttempt(
        RunAttempt.createFirst({
          id: ids.runAttemptId,
          runId: ids.runId,
          createdAt: NOW,
        }),
      );

      const step = RunStep.create({
        id: ids.runStepId,
        runId: ids.runId,
        runAttemptId: ids.runAttemptId,
        type: "model.generate",
        name: "generate",
        startedAt: NOW,
        completedAt: LATER,
        metadata: { tokens: 12 },
      });
      await runs.saveRunStep(step);

      const [row] = await database.db
        .select()
        .from(runSteps)
        .where(eq(runSteps.id, ids.runStepId))
        .limit(1);
      expect(row).toBeDefined();
      if (row === undefined) {
        throw new Error("Expected the saved RunStep row to exist.");
      }
      const loaded = runStepFromRow(row);
      expect(loaded.runId).toBe(ids.runId);
      expect(loaded.runAttemptId).toBe(ids.runAttemptId);
      expect(loaded.metadata).toEqual({ tokens: 12 });
      expect(loaded.completedAt).toEqual(LATER);
    });

    it("rejects a RunStep whose RunAttempt does not belong to the same Run", async () => {
      const { ids } = await seedAgentGraph();
      const bindings = createBindings(
        ids.agentVersionId,
        ids.modelProfileVersionId,
      );
      await runs.saveRun(
        Run.create({
          input: RUN_INPUT,
          id: ids.runId,
          workspaceId: ids.workspaceId,
          agentId: ids.agentId,
          effectiveBindings: bindings,
          createdAt: NOW,
        }),
      );
      await runs.saveRun(
        Run.create({
          input: RUN_INPUT,
          id: ids.otherRunId,
          workspaceId: ids.workspaceId,
          agentId: ids.agentId,
          effectiveBindings: bindings,
          createdAt: NOW,
        }),
      );
      await runs.saveRunAttempt(
        RunAttempt.createFirst({
          id: ids.runAttemptId,
          runId: ids.runId,
          createdAt: NOW,
        }),
      );
      await runs.saveRunAttempt(
        RunAttempt.createFirst({
          id: ids.otherAttemptId,
          runId: ids.otherRunId,
          createdAt: NOW,
        }),
      );

      await expect(
        runs.saveRunStep(
          RunStep.create({
            id: ids.runStepId,
            runId: ids.runId,
            runAttemptId: ids.otherAttemptId as RunAttemptId,
            type: "model.generate",
            name: "generate",
            startedAt: NOW,
          }),
        ),
      ).rejects.toBeInstanceOf(DomainInvariantError);
    });
  });

  describe("ownership consistency", () => {
    it("rejects a Run whose Agent belongs to another Workspace", async () => {
      const home = await seedAgentGraph();
      const other = await seedAgentGraph();

      await expect(
        runs.saveRun(
          Run.create({
            input: RUN_INPUT,
            id: home.ids.runId,
            workspaceId: home.ids.workspaceId,
            agentId: other.ids.agentId,
            effectiveBindings: createBindings(
              other.ids.agentVersionId,
              other.ids.modelProfileVersionId,
            ),
            createdAt: NOW,
          }),
        ),
      ).rejects.toBeInstanceOf(DomainInvariantError);
    });

    it("rejects a Run whose AgentVersion belongs to another Agent", async () => {
      const home = await seedAgentGraph();
      const other = await seedAgentGraph();

      await expect(
        runs.saveRun(
          Run.create({
            input: RUN_INPUT,
            id: home.ids.runId,
            workspaceId: home.ids.workspaceId,
            agentId: home.ids.agentId,
            effectiveBindings: createBindings(
              other.ids.agentVersionId,
              home.ids.modelProfileVersionId,
            ),
            createdAt: NOW,
          }),
        ),
      ).rejects.toBeInstanceOf(DomainInvariantError);
    });

    it("rejects a Deployment whose Agent belongs to another Workspace", async () => {
      const home = await seedAgentGraph();
      const other = await seedAgentGraph();

      await expectForeignKeyViolation(() =>
        database.db.insert(deployments).values({
          id: `deployment_${home.ids.runId}`,
          workspaceId: home.ids.workspaceId,
          agentId: other.ids.agentId,
          agentVersionId: other.ids.agentVersionId,
          environment: "staging",
          createdAt: NOW,
        }),
      );
    });

    it("rejects a Deployment whose AgentVersion belongs to another Agent", async () => {
      const home = await seedAgentGraph();
      const other = await seedAgentGraph();

      await expectForeignKeyViolation(() =>
        database.db.insert(deployments).values({
          id: `deployment_${home.ids.runId}`,
          workspaceId: home.ids.workspaceId,
          agentId: home.ids.agentId,
          agentVersionId: other.ids.agentVersionId,
          environment: "staging",
          createdAt: NOW,
        }),
      );
    });

    it("persists a valid Deployment relationship", async () => {
      const { ids } = await seedAgentGraph();

      await database.db.insert(deployments).values({
        id: `deployment_${ids.runId}`,
        workspaceId: ids.workspaceId,
        agentId: ids.agentId,
        agentVersionId: ids.agentVersionId,
        environment: "staging",
        createdAt: NOW,
      });

      const [row] = await database.db
        .select()
        .from(deployments)
        .where(eq(deployments.id, `deployment_${ids.runId}`))
        .limit(1);

      expect(row).toMatchObject({
        workspaceId: ids.workspaceId,
        agentId: ids.agentId,
        agentVersionId: ids.agentVersionId,
        environment: "staging",
      });
    });
  });

  describe("Slice 1.2 Run lifecycle", () => {
    it("creates a Run and initial RunAttempt in one transaction", async () => {
      const { ids } = await seedAgentGraph();
      const pending = Run.create({
        input: RUN_INPUT,
        id: ids.runId,
        workspaceId: ids.workspaceId,
        agentId: ids.agentId,
        effectiveBindings: createBindings(
          ids.agentVersionId,
          ids.modelProfileVersionId,
        ),
        createdAt: NOW,
      });
      const attempt = RunAttempt.createFirst({
        id: ids.runAttemptId,
        runId: ids.runId,
        createdAt: NOW,
      });

      await runs.createRunWithInitialAttempt(pending, attempt);

      expect(await runs.findRunById(ids.runId)).not.toBeNull();
      expect(await runs.findRunAttemptById(ids.runAttemptId)).not.toBeNull();
    });

    it("rolls back the Run when initial RunAttempt persistence fails", async () => {
      const { ids } = await seedAgentGraph();
      const bindings = createBindings(
        ids.agentVersionId,
        ids.modelProfileVersionId,
      );
      await runs.createRunWithInitialAttempt(
        Run.create({
          input: RUN_INPUT,
          id: ids.runId,
          workspaceId: ids.workspaceId,
          agentId: ids.agentId,
          effectiveBindings: bindings,
          createdAt: NOW,
        }),
        RunAttempt.createFirst({
          id: ids.runAttemptId,
          runId: ids.runId,
          createdAt: NOW,
        }),
      );

      await expect(
        runs.createRunWithInitialAttempt(
          Run.create({
            input: RUN_INPUT,
            id: ids.otherRunId,
            workspaceId: ids.workspaceId,
            agentId: ids.agentId,
            effectiveBindings: bindings,
            createdAt: NOW,
          }),
          RunAttempt.createFirst({
            id: ids.runAttemptId,
            runId: ids.otherRunId,
            createdAt: NOW,
          }),
        ),
      ).rejects.toBeInstanceOf(DomainInvariantError);

      expect(await runs.findRunById(ids.otherRunId)).toBeNull();
      expect((await runs.findRunAttemptById(ids.runAttemptId))?.runId).toBe(
        ids.runId,
      );
    });

    it("does not overwrite immutable Run fields during a lifecycle transition", async () => {
      const { ids } = await seedAgentGraph();
      const pending = Run.create({
        input: RUN_INPUT,
        id: ids.runId,
        workspaceId: ids.workspaceId,
        agentId: ids.agentId,
        effectiveBindings: createBindings(
          ids.agentVersionId,
          ids.modelProfileVersionId,
        ),
        createdAt: NOW,
      });
      await runs.saveRun(pending);

      const spoofed = Run.rehydrate({
        id: pending.id,
        workspaceId: pending.workspaceId,
        agentId: ids.otherAgentId,
        status: "QUEUED",
        effectiveBindings: createBindings(
          ids.otherAgentVersionId,
          ids.modelProfileVersionId,
        ),
        input: { mutated: true },
        createdAt: LATER,
        updatedAt: LATER,
        idempotencyKey: "changed",
      });

      const stored = await runs.transitionRun("PENDING", spoofed);
      expect(stored.agentId).toBe(ids.agentId);
      expect(stored.effectiveBindings.agentVersionId).toBe(ids.agentVersionId);
      expect(stored.input).toEqual(RUN_INPUT);
      expect(stored.createdAt).toEqual(NOW);
      expect(stored.idempotencyKey).toBeUndefined();
    });

    it("does not move a RunAttempt onto another Run during a lifecycle transition", async () => {
      const { ids } = await seedAgentGraph();
      await runs.saveRun(
        Run.create({
          input: RUN_INPUT,
          id: ids.runId,
          workspaceId: ids.workspaceId,
          agentId: ids.agentId,
          effectiveBindings: createBindings(
            ids.agentVersionId,
            ids.modelProfileVersionId,
          ),
          createdAt: NOW,
        }),
      );
      const pending = RunAttempt.createFirst({
        id: ids.runAttemptId,
        runId: ids.runId,
        createdAt: NOW,
      });
      await runs.saveRunAttempt(pending);

      const stored = await runs.transitionRunAttempt(
        "PENDING",
        RunAttempt.rehydrate({
          id: pending.id,
          runId: ids.otherRunId,
          sequence: 99,
          status: "RUNNING",
          createdAt: LATER,
          startedAt: LATER,
        }),
      );

      expect(stored.runId).toBe(ids.runId);
      expect(stored.sequence).toBe(1);
      expect(stored.createdAt).toEqual(NOW);
    });

    it("rejects invalid Stage 0 Run and RunAttempt transitions", async () => {
      const { ids } = await seedAgentGraph();
      const pending = Run.create({
        input: RUN_INPUT,
        id: ids.runId,
        workspaceId: ids.workspaceId,
        agentId: ids.agentId,
        effectiveBindings: createBindings(
          ids.agentVersionId,
          ids.modelProfileVersionId,
        ),
        createdAt: NOW,
      });
      await runs.saveRun(pending);
      const attempt = RunAttempt.createFirst({
        id: ids.runAttemptId,
        runId: ids.runId,
        createdAt: NOW,
      });
      await runs.saveRunAttempt(attempt);

      await expect(
        runs.transitionRun(
          "PENDING",
          Run.rehydrate({
            id: pending.id,
            workspaceId: pending.workspaceId,
            agentId: pending.agentId,
            status: "SUCCEEDED",
            effectiveBindings: pending.effectiveBindings,
            input: pending.input,
            createdAt: pending.createdAt,
            updatedAt: LATER,
          }),
        ),
      ).rejects.toBeInstanceOf(InvalidRunTransitionError);

      await expect(
        runs.transitionRunAttempt(
          "PENDING",
          attempt
            .transitionTo("RUNNING", LATER)
            .transitionTo("SUCCEEDED", LATER),
        ),
      ).rejects.toBeInstanceOf(InvalidRunAttemptTransitionError);
    });

    it("allows only one of two concurrent transitions from the same expected state", async () => {
      const { ids } = await seedAgentGraph();
      const pending = Run.create({
        input: RUN_INPUT,
        id: ids.runId,
        workspaceId: ids.workspaceId,
        agentId: ids.agentId,
        effectiveBindings: createBindings(
          ids.agentVersionId,
          ids.modelProfileVersionId,
        ),
        createdAt: NOW,
      });
      await runs.saveRun(pending);

      const results = await Promise.allSettled([
        runs.transitionRun("PENDING", pending.transitionTo("QUEUED", LATER)),
        runs.transitionRun(
          "PENDING",
          pending.transitionTo("QUEUED", EVEN_LATER),
        ),
      ]);

      const fulfilled = results.filter(
        (result) => result.status === "fulfilled",
      );
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        LifecycleConflictError,
      );
      expect((await runs.findRunById(ids.runId))?.status).toBe("QUEUED");
    });

    it("lists Runs with createdAt/id ordering, pagination, and filters", async () => {
      const { ids } = await seedAgentGraph();
      const bindings = createBindings(
        ids.agentVersionId,
        ids.modelProfileVersionId,
      );
      await runs.saveRun(
        Run.create({
          input: { n: 1 },
          id: "run-a" as RunId,
          workspaceId: ids.workspaceId,
          agentId: ids.agentId,
          effectiveBindings: bindings,
          createdAt: NOW,
        }),
      );
      await runs.saveRun(
        Run.create({
          input: { n: 2 },
          id: "run-c" as RunId,
          workspaceId: ids.workspaceId,
          agentId: ids.agentId,
          effectiveBindings: bindings,
          createdAt: NOW,
        }),
      );
      await runs.saveRun(
        Run.create({
          input: { n: 3 },
          id: "run-b" as RunId,
          workspaceId: ids.workspaceId,
          agentId: ids.agentId,
          effectiveBindings: bindings,
          createdAt: NOW,
        }),
      );

      const firstPage = await runs.listRuns({ limit: 2 });
      expect(firstPage.runs.map((run) => run.id)).toEqual(["run-c", "run-b"]);
      expect(firstPage.nextCursor?.id).toBe("run-b" as RunId);

      const secondPage = await runs.listRuns({
        limit: 2,
        cursor: firstPage.nextCursor,
      });
      expect(secondPage.runs.map((run) => run.id)).toEqual(["run-a"]);
      expect(secondPage.nextCursor).toBeUndefined();

      const runC = await runs.findRunById("run-c" as RunId);
      if (runC === null) {
        throw new Error("expected run-c");
      }
      await runs.transitionRun("PENDING", runC.transitionTo("QUEUED", LATER));

      const queued = await runs.listRuns({ limit: 10, status: "QUEUED" });
      expect(queued.runs.map((run) => run.id)).toEqual(["run-c"]);

      const byAgent = await runs.listRuns({
        limit: 10,
        agentId: ids.agentId,
      });
      expect(byAgent.runs).toHaveLength(3);

      const byVersion = await runs.listRuns({
        limit: 10,
        agentVersionId: ids.agentVersionId,
      });
      expect(byVersion.runs).toHaveLength(3);
    });

    it("throws RunNotFoundError when transitioning a missing Run", async () => {
      const { ids } = await seedAgentGraph();
      await expect(
        runs.transitionRun(
          "PENDING",
          Run.create({
            input: RUN_INPUT,
            id: ids.runId,
            workspaceId: ids.workspaceId,
            agentId: ids.agentId,
            effectiveBindings: createBindings(
              ids.agentVersionId,
              ids.modelProfileVersionId,
            ),
            createdAt: NOW,
          }).transitionTo("QUEUED", LATER),
        ),
      ).rejects.toBeInstanceOf(RunNotFoundError);
    });
  });
});

async function expectForeignKeyViolation(
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    expect(postgresErrorCode(error)).toBe(POSTGRES_FOREIGN_KEY_VIOLATION);
    return;
  }

  throw new Error("Expected a foreign key constraint violation.");
}
