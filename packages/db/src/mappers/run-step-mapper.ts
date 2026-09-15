import type { RunAttemptId, RunId, RunStepId } from "@osva/contracts";
import {
  DomainInvariantError,
  RunStep,
  type RunStepMetadata,
} from "@osva/domain";

import type { runSteps } from "../schema/run-steps.js";
import { toDomainDate, toOptionalDomainDate } from "./timestamps.js";

type RunStepRow = typeof runSteps.$inferSelect;

export function runStepToRow(step: RunStep) {
  return {
    id: step.id,
    runId: step.runId,
    runAttemptId: step.runAttemptId,
    type: step.type,
    name: step.name,
    startedAt: step.startedAt,
    completedAt: step.completedAt ?? null,
    metadata: step.metadata ?? null,
  };
}

export function runStepFromRow(row: RunStepRow): RunStep {
  return RunStep.create({
    id: row.id as RunStepId,
    runId: row.runId as RunId,
    runAttemptId: row.runAttemptId as RunAttemptId,
    type: row.type,
    name: row.name,
    startedAt: toDomainDate(row.startedAt),
    completedAt: toOptionalDomainDate(row.completedAt),
    metadata: toOptionalMetadata(row.metadata),
  });
}

function toOptionalMetadata(value: unknown): RunStepMetadata | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainInvariantError(
      "Persisted RunStep.metadata must be an object.",
    );
  }

  return value as RunStepMetadata;
}
