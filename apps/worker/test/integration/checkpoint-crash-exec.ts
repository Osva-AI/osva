import fs from "node:fs";
import type { RunAttemptId } from "@osva-ai/contracts";
import {
  createDatabase,
  PostgresAgentRepository,
  PostgresRunCheckpointRepository,
  PostgresRunOperationJournalRepository,
  PostgresRunRepository,
} from "@osva/db";
import { ExecuteRunAttempt } from "@osva/orchestration";

import { setCheckpointCrashPhaseOverride } from "@osva/adapters-runtime-declarative";
import {
  buildToolCallCompletion,
  createCheckpointCrashInjectionRuntime,
  declarativeCheckpointOutputSchema,
} from "./checkpoint-crash-injection-runtime.ts";

const EXECUTION_OWNER = "checkpoint-crash-exec";

async function main(): Promise<void> {
  const runAttemptId = process.argv[2] as RunAttemptId | undefined;
  const countersPath = process.argv[3];
  const owner = process.argv[4] ?? EXECUTION_OWNER;
  const crashPhase = process.argv[5];
  setCheckpointCrashPhaseOverride(
    crashPhase === undefined || crashPhase.length === 0
      ? undefined
      : crashPhase,
  );
  if (runAttemptId === undefined || countersPath === undefined) {
    throw new Error(
      "Usage: checkpoint-crash-exec.ts <runAttemptId> <countersPath> [owner]",
    );
  }

  const databaseUrl = process.env.OSVA_DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error("OSVA_DATABASE_URL is required.");
  }

  const scenario =
    process.env.OSVA_CHECKPOINT_CRASH_SCENARIO ?? "model_then_answer";
  const counters = { modelInvocations: 0, toolInvocations: 0 };
  process.on("exit", () => {
    fs.writeFileSync(countersPath, JSON.stringify(counters));
  });

  const database = createDatabase({ connectionString: databaseUrl, max: 4 });
  const runs = new PostgresRunRepository(database);
  const agents = new PostgresAgentRepository(database);
  const checkpoints = new PostgresRunCheckpointRepository(database);
  const operationJournal = new PostgresRunOperationJournalRepository(database);

  const modelSequence =
    scenario === "tool_flow"
      ? [
          buildToolCallCompletion([
            {
              id: "call-echo-1",
              name: "echo",
              arguments: { value: "crash-test" },
            },
          ]),
        ]
      : [];

  const runtime = createCheckpointCrashInjectionRuntime({
    outputSchema: declarativeCheckpointOutputSchema(),
    bindingName: "echo",
    toolVersionId: (process.env.OSVA_CHECKPOINT_TOOL_VERSION_ID ??
      "tool-version-echo-1") as import("@osva-ai/contracts").ToolVersionId,
    toolMetadata: {
      inputSchema: {
        type: "object",
        properties: { value: {} },
        required: ["value"],
        additionalProperties: false,
      },
      idempotencyClass:
        process.env.OSVA_CHECKPOINT_TOOL_CLASS === "READ_ONLY"
          ? "READ_ONLY"
          : "PURE",
    },
    modelSequence,
    toolResult: { value: "crash-test" },
    counters,
  });

  const executeRunAttempt = new ExecuteRunAttempt({
    runs,
    agents,
    checkpoints,
    operationJournal,
    runtime,
    executionOwner: owner,
    leaseTtlMs: 120_000,
    heartbeatIntervalMs: 60_000,
  });

  try {
    await executeRunAttempt.execute({
      runAttemptId,
      now: new Date(),
    });
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
