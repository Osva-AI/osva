import type {
  ModelProfileVersionId,
  RunAttemptId,
  RunId,
  RunStepId,
  RunStepKind,
  RunStepStatus,
  ToolVersionId,
} from "@osva/contracts";
import { RunStep } from "@osva/domain";

import type { runSteps } from "../schema/run-steps.js";
import { toDomainDate, toOptionalDomainDate } from "./timestamps.js";

type RunStepRow = typeof runSteps.$inferSelect;

export function runStepToRow(step: RunStep) {
  return {
    id: step.id,
    runId: step.runId,
    runAttemptId: step.runAttemptId,
    kind: step.kind,
    bindingName: step.bindingName,
    status: step.status,
    startedAt: step.startedAt,
    completedAt: step.completedAt ?? null,
    modelProfileVersionId: step.modelProfileVersionId ?? null,
    toolVersionId: step.toolVersionId ?? null,
    inputTokens: step.inputTokens ?? null,
    outputTokens: step.outputTokens ?? null,
    totalTokens: step.totalTokens ?? null,
    cachedInputTokens: step.cachedInputTokens ?? null,
    estimatedCostUsdMicros: step.estimatedCostUsdMicros ?? null,
    errorCode: step.errorCode ?? null,
  };
}

export function runStepFromRow(row: RunStepRow): RunStep {
  return RunStep.create({
    id: row.id as RunStepId,
    runId: row.runId as RunId,
    runAttemptId: row.runAttemptId as RunAttemptId,
    kind: row.kind as RunStepKind,
    bindingName: row.bindingName,
    status: row.status as RunStepStatus,
    startedAt: toDomainDate(row.startedAt),
    completedAt: toOptionalDomainDate(row.completedAt),
    modelProfileVersionId:
      row.modelProfileVersionId === null
        ? undefined
        : (row.modelProfileVersionId as ModelProfileVersionId),
    toolVersionId:
      row.toolVersionId === null
        ? undefined
        : (row.toolVersionId as ToolVersionId),
    inputTokens: row.inputTokens ?? undefined,
    outputTokens: row.outputTokens ?? undefined,
    totalTokens: row.totalTokens ?? undefined,
    cachedInputTokens: row.cachedInputTokens ?? undefined,
    estimatedCostUsdMicros: row.estimatedCostUsdMicros,
    errorCode: row.errorCode ?? undefined,
  });
}
