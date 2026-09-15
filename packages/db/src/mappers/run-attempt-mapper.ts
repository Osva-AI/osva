import type { RunAttemptId, RunAttemptState, RunId } from "@osva/contracts";
import {
  DomainInvariantError,
  RunAttempt,
  type InfrastructureMetadata,
  type RunAttemptError,
} from "@osva/domain";

import type { runAttempts } from "../schema/run-attempts.js";
import { toDomainDate, toOptionalDomainDate } from "./timestamps.js";

type RunAttemptRow = typeof runAttempts.$inferSelect;

export function runAttemptToRow(attempt: RunAttempt) {
  return {
    id: attempt.id,
    runId: attempt.runId,
    sequence: attempt.sequence,
    status: attempt.status,
    createdAt: attempt.createdAt,
    startedAt: attempt.startedAt ?? null,
    completedAt: attempt.completedAt ?? null,
    error: attempt.error ?? null,
    infrastructureMetadata: attempt.infrastructureMetadata ?? null,
  };
}

export function runAttemptFromRow(row: RunAttemptRow): RunAttempt {
  return RunAttempt.rehydrate({
    id: row.id as RunAttemptId,
    runId: row.runId as RunId,
    sequence: row.sequence,
    status: row.status as RunAttemptState,
    createdAt: toDomainDate(row.createdAt),
    startedAt: toOptionalDomainDate(row.startedAt),
    completedAt: toOptionalDomainDate(row.completedAt),
    error: toOptionalError(row.error),
    infrastructureMetadata: toOptionalMetadata(row.infrastructureMetadata),
  });
}

function toOptionalError(value: unknown): RunAttemptError | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (
    typeof value !== "object" ||
    typeof (value as { code?: unknown }).code !== "string" ||
    typeof (value as { message?: unknown }).message !== "string"
  ) {
    throw new DomainInvariantError(
      "Persisted RunAttempt.error must include code and message strings.",
    );
  }

  return {
    code: (value as RunAttemptError).code,
    message: (value as RunAttemptError).message,
  };
}

function toOptionalMetadata(
  value: unknown,
): InfrastructureMetadata | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainInvariantError(
      "Persisted RunAttempt.infrastructureMetadata must be an object.",
    );
  }

  return value as InfrastructureMetadata;
}
