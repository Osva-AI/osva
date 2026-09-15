import type {
  AgentId,
  AgentVersionId,
  ModelProfileVersionId,
  ToolVersionId,
  RunId,
  RunState,
  WorkspaceId,
} from "@osva/contracts";
import { DomainInvariantError, EffectiveRunBindings, Run } from "@osva/domain";

import type { runs } from "../schema/runs.js";
import { toDomainDate } from "./timestamps.js";

type RunRow = typeof runs.$inferSelect;

export function runToRow(run: Run) {
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    agentId: run.agentId,
    status: run.status,
    agentVersionId: run.effectiveBindings.agentVersionId,
    modelProfileVersionBindings:
      run.effectiveBindings.modelProfileVersionBindings,
    toolVersionBindings: run.effectiveBindings.toolVersionBindings,
    input: run.input,
    idempotencyKey: run.idempotencyKey ?? null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export function runFromRow(row: RunRow): Run {
  return Run.rehydrate({
    id: row.id as RunId,
    workspaceId: row.workspaceId as WorkspaceId,
    agentId: row.agentId as AgentId,
    status: row.status as RunState,
    effectiveBindings: EffectiveRunBindings.create({
      agentVersionId: row.agentVersionId as AgentVersionId,
      modelProfileVersionBindings: toModelProfileVersionBindings(
        row.modelProfileVersionBindings,
      ),
      toolVersionBindings: toToolVersionBindings(row.toolVersionBindings),
    }),
    input: row.input,
    createdAt: toDomainDate(row.createdAt),
    updatedAt: toDomainDate(row.updatedAt),
    idempotencyKey: row.idempotencyKey ?? undefined,
  });
}

function toModelProfileVersionBindings(
  value: unknown,
): Readonly<Record<string, ModelProfileVersionId>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainInvariantError(
      "Persisted modelProfileVersionBindings must be a map.",
    );
  }

  const bindings: Record<string, ModelProfileVersionId> = {};

  for (const [key, binding] of Object.entries(value)) {
    if (typeof binding !== "string" || binding.length === 0) {
      throw new DomainInvariantError(
        "Persisted modelProfileVersionBindings values must be non-empty strings.",
      );
    }

    bindings[key] = binding as ModelProfileVersionId;
  }

  return bindings;
}

function toToolVersionBindings(
  value: unknown,
): Readonly<Record<string, ToolVersionId>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainInvariantError(
      "Persisted toolVersionBindings must be a map.",
    );
  }

  const bindings: Record<string, ToolVersionId> = {};

  for (const [key, binding] of Object.entries(value)) {
    if (typeof binding !== "string" || binding.length === 0) {
      throw new DomainInvariantError(
        "Persisted toolVersionBindings values must be non-empty strings.",
      );
    }

    bindings[key] = binding as ToolVersionId;
  }

  return bindings;
}
