import type {
  AgentId,
  AgentVersionId,
  EvaluationCaseId,
  EvaluationRunId,
  MemoryAccessMode,
  MemoryNamespaceBinding,
  KnowledgeIndexId,
  MemoryNamespaceId,
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
    memoryNamespaceBindings: run.effectiveBindings.memoryNamespaceBindings,
    knowledgeIndexBindings: run.effectiveBindings.knowledgeIndexBindings,
    evaluationRunId: run.evaluationRunId ?? null,
    evaluationCaseId: run.evaluationCaseId ?? null,
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
      memoryNamespaceBindings: toMemoryNamespaceBindings(
        row.memoryNamespaceBindings,
      ),
      knowledgeIndexBindings: toKnowledgeIndexBindings(
        row.knowledgeIndexBindings,
      ),
    }),
    input: row.input,
    createdAt: toDomainDate(row.createdAt),
    updatedAt: toDomainDate(row.updatedAt),
    idempotencyKey: row.idempotencyKey ?? undefined,
    evaluationRunId:
      (row.evaluationRunId as EvaluationRunId | null) ?? undefined,
    evaluationCaseId:
      (row.evaluationCaseId as EvaluationCaseId | null) ?? undefined,
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

function toMemoryNamespaceBindings(
  value: unknown,
): Readonly<Record<string, MemoryNamespaceBinding>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainInvariantError(
      "Persisted memoryNamespaceBindings must be a map.",
    );
  }

  const bindings: Record<string, MemoryNamespaceBinding> = {};

  for (const [key, binding] of Object.entries(value)) {
    if (
      binding === null ||
      typeof binding !== "object" ||
      Array.isArray(binding)
    ) {
      throw new DomainInvariantError(
        "Persisted memoryNamespaceBindings values must be objects.",
      );
    }

    const namespaceId = (binding as { namespaceId?: unknown }).namespaceId;
    const access = (binding as { access?: unknown }).access;
    if (typeof namespaceId !== "string" || namespaceId.length === 0) {
      throw new DomainInvariantError(
        "Persisted memoryNamespaceBindings.namespaceId must be a non-empty string.",
      );
    }
    if (access !== "READ_ONLY" && access !== "READ_WRITE") {
      throw new DomainInvariantError(
        "Persisted memoryNamespaceBindings.access must be READ_ONLY or READ_WRITE.",
      );
    }

    bindings[key] = {
      namespaceId: namespaceId as MemoryNamespaceId,
      access: access as MemoryAccessMode,
    };
  }

  return bindings;
}

function toKnowledgeIndexBindings(
  value: unknown,
): Readonly<Record<string, readonly KnowledgeIndexId[]>> {
  if (value === null || value === undefined) {
    return {};
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainInvariantError(
      "Persisted knowledgeIndexBindings must be a map.",
    );
  }

  const bindings: Record<string, readonly KnowledgeIndexId[]> = {};

  for (const [key, ids] of Object.entries(value)) {
    if (!Array.isArray(ids)) {
      throw new DomainInvariantError(
        "Persisted knowledgeIndexBindings values must be arrays.",
      );
    }

    const parsed: KnowledgeIndexId[] = [];
    for (const id of ids) {
      if (typeof id !== "string" || id.length === 0) {
        throw new DomainInvariantError(
          "Persisted knowledgeIndexBindings entries must be non-empty strings.",
        );
      }
      parsed.push(id as KnowledgeIndexId);
    }

    bindings[key] = parsed;
  }

  return bindings;
}
