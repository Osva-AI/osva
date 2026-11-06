import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import type {
  AgentId,
  AgentVersionId,
  RunAttemptId,
  RunId,
  ToolVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import {
  PostgresAgentRepository,
  PostgresRunCheckpointRepository,
  PostgresRunOperationJournalRepository,
  PostgresRunRepository,
  PostgresToolRepository,
  type Database,
} from "@osva/db";
import {
  Agent,
  AgentVersion,
  EffectiveRunBindings,
  Tool,
  ToolVersion,
} from "@osva/domain";
import { CreateRun, ExecutionRecoveryTick } from "@osva/orchestration";
import {
  CHECKPOINT_CRASH_EXIT_CODE,
  type CheckpointCrashPhase,
} from "@osva/adapters-runtime-declarative";

const NOW = new Date("2026-01-15T12:00:00.000Z");

export interface CheckpointCrashFixture {
  readonly workspaceId: WorkspaceId;
  readonly agentId: AgentId;
  readonly agentVersionId: AgentVersionId;
  readonly toolVersionId: ToolVersionId;
  readonly modelProfileVersionId: import("@osva-ai/contracts").ModelProfileVersionId;
}

export async function seedCheckpointCrashFixture(
  database: Database,
  workspaceId: WorkspaceId,
): Promise<CheckpointCrashFixture> {
  const agents = new PostgresAgentRepository(database);
  const tools = new PostgresToolRepository(database);
  const agentId = "agent-crash-1" as AgentId;
  const agentVersionId = "agent-version-crash-1" as AgentVersionId;
  const toolVersionId = "tool-version-echo-1" as ToolVersionId;
  const modelProfileVersionId =
    "model-profile-version-crash-1" as import("@osva-ai/contracts").ModelProfileVersionId;

  await agents.saveAgent(
    Agent.create({
      id: agentId,
      workspaceId,
      key: "crash-agent",
      name: "Crash Agent",
      createdAt: NOW,
    }),
  );

  await tools.saveTool(
    Tool.create({
      id: "tool-echo-1" as import("@osva-ai/contracts").ToolId,
      workspaceId,
      key: "echo",
      name: "Echo",
      createdAt: NOW,
    }),
  );
  await tools.saveToolVersion(
    ToolVersion.create({
      id: toolVersionId,
      toolId: "tool-echo-1" as import("@osva-ai/contracts").ToolId,
      version: 1,
      type: "INTERNAL",
      implementation: "OSVA_ECHO_V1",
      createdAt: NOW,
    }),
  );

  await agents.saveAgentVersion(
    AgentVersion.create({
      id: agentVersionId,
      agentId,
      version: 1,
      manifest: {
        schemaVersion: "1",
        key: "crash-agent",
        name: "Crash Agent",
        runtime: {
          type: "DECLARATIVE",
          config: {
            configVersion: "1",
            instructions: "Test checkpoint crash harness.",
            modelBinding: "default",
            allowedToolBindings: ["echo"],
            maxModelInvocations: 5,
            maxToolInvocations: 5,
            maxOutputTokens: 256,
            checkpointingEnabled: true,
            automaticRecoveryEnabled: true,
          },
        },
        models: {
          default: { modelProfileVersionId },
        },
        tools: {
          echo: { toolVersionId },
        },
        input: { schema: { type: "object" } },
        output: {
          schema: {
            type: "object",
            properties: { answer: { type: "string" } },
            required: ["answer"],
            additionalProperties: false,
          },
        },
        execution: { timeoutMs: 60_000, maxAttempts: 4 },
        capabilities: { model: true, tools: ["echo"] },
      },
      createdAt: NOW,
    }),
  );

  return {
    workspaceId,
    agentId,
    agentVersionId,
    toolVersionId,
    modelProfileVersionId,
  };
}

export async function createCheckpointRun(input: {
  readonly database: Database;
  readonly valkeyUrl: string;
  readonly fixture: CheckpointCrashFixture;
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
}): Promise<void> {
  const runs = new PostgresRunRepository(input.database);
  const agents = new PostgresAgentRepository(input.database);
  const queue = new BullMqJobQueue({ url: input.valkeyUrl });
  try {
    await new CreateRun({ runs, agents, queue }).execute({
      runId: input.runId,
      runAttemptId: input.runAttemptId,
      workspaceId: input.fixture.workspaceId,
      agentId: input.fixture.agentId,
      agentVersionId: input.fixture.agentVersionId,
      input: { scenario: "checkpoint-crash" },
      now: NOW,
    });
  } finally {
    await queue.shutdown();
  }
}

export function spawnCheckpointCrashExec(input: {
  readonly databaseUrl: string;
  readonly runAttemptId: RunAttemptId;
  readonly crashPhase?: CheckpointCrashPhase;
  readonly scenario: string;
  readonly countersPath: string;
  readonly owner: string;
  readonly toolVersionId?: ToolVersionId;
  readonly toolClass?: "READ_ONLY" | "PURE";
}): {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const execScript = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "checkpoint-crash-exec.ts",
  );
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../..",
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OSVA_DATABASE_URL: input.databaseUrl,
    OSVA_CHECKPOINT_CRASH_SCENARIO: input.scenario,
  };
  if (input.crashPhase !== undefined) {
    env.OSVA_CHECKPOINT_CRASH_AT = input.crashPhase;
  } else {
    delete env.OSVA_CHECKPOINT_CRASH_AT;
  }
  if (input.toolVersionId !== undefined) {
    env.OSVA_CHECKPOINT_TOOL_VERSION_ID = input.toolVersionId;
  }
  if (input.toolClass !== undefined) {
    env.OSVA_CHECKPOINT_TOOL_CLASS = input.toolClass;
  }
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      execScript,
      input.runAttemptId,
      input.countersPath,
      input.owner,
      input.crashPhase ?? "",
    ],
    {
      cwd: repoRoot,
      env,
      stdio: "pipe",
      encoding: "utf8",
    },
  );
  if (result.error !== undefined) {
    throw result.error;
  }
  if (
    result.status !== CHECKPOINT_CRASH_EXIT_CODE &&
    result.status !== 0 &&
    result.status !== null
  ) {
    throw new Error(
      `checkpoint-crash-exec failed: status=${String(result.status)} stderr=${result.stderr ?? ""} stdout=${result.stdout ?? ""}`,
    );
  }
  return {
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export async function readCounters(countersPath: string): Promise<{
  readonly modelInvocations: number;
  readonly toolInvocations: number;
}> {
  const raw = await fs.readFile(countersPath, "utf8");
  return JSON.parse(raw) as {
    modelInvocations: number;
    toolInvocations: number;
  };
}

export async function tempCountersPath(): Promise<string> {
  return path.join(
    os.tmpdir(),
    `osva-checkpoint-counters-${String(Date.now())}-${Math.random().toString(16).slice(2)}.json`,
  );
}

export async function interruptAndRecover(input: {
  readonly database: Database;
  readonly valkeyUrl: string;
  readonly runId: RunId;
  readonly leaseExpiredAt: Date;
}): Promise<RunAttemptId | null> {
  const runs = new PostgresRunRepository(input.database);
  const agents = new PostgresAgentRepository(input.database);
  const queue = new BullMqJobQueue({ url: input.valkeyUrl });
  const checkpoints = new PostgresRunCheckpointRepository(input.database);
  const operationJournal = new PostgresRunOperationJournalRepository(
    input.database,
  );

  const attempts = await runs.listRunAttempts(input.runId);
  const running = attempts.find((row) => row.status === "RUNNING");
  if (running === undefined) {
    await queue.shutdown();
    return null;
  }

  await input.database.sql`
    update run_attempts
    set lease_expires_at = now() - interval '5 seconds'
    where id = ${running.id}
  `;

  await runs.interruptExpiredLeasedAttemptForRecovery({
    runAttemptId: running.id,
    generation: running.executionGeneration,
    now: input.leaseExpiredAt,
    error: {
      code: "EXECUTION_INTERRUPTED",
      message: "Lease expired during crash acceptance test.",
    },
    recoveryMetadata: {
      version: "1",
      recoveryAttemptCount: 0,
      automaticRecoveryEnabled: true,
    },
  });

  const tick = new ExecutionRecoveryTick({
    runs,
    queue,
    checkpoints,
    operationJournal,
    agents,
    createRunAttemptId: () => `recovery-${String(Date.now())}` as RunAttemptId,
    clock: { now: () => input.leaseExpiredAt },
  });
  await tick.execute();

  const nextAttempts = await runs.listRunAttempts(input.runId);
  const successor = nextAttempts.find((row) => row.status === "PENDING");
  await queue.shutdown();
  return successor?.id ?? null;
}

export function expectCrashExit(
  result: {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  },
  spawn?: { stderr?: string; stdout?: string },
): void {
  if (result.exitCode === CHECKPOINT_CRASH_EXIT_CODE) {
    return;
  }
  throw new Error(
    `Expected crash exit ${String(CHECKPOINT_CRASH_EXIT_CODE)}, got code=${String(result.exitCode)} signal=${String(result.signal)} stderr=${spawn?.stderr ?? ""} stdout=${spawn?.stdout ?? ""}`,
  );
}

export function buildEffectiveBindings(
  fixture: CheckpointCrashFixture,
): EffectiveRunBindings {
  return EffectiveRunBindings.create({
    agentVersionId: fixture.agentVersionId,
    modelProfileVersionBindings: {
      default: fixture.modelProfileVersionId,
    },
    toolVersionBindings: { echo: fixture.toolVersionId },
    memoryNamespaceBindings: {},
    knowledgeIndexBindings: {},
  });
}
