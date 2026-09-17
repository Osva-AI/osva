import type { MemoryNamespaceId, WorkspaceId } from "@osva/contracts";
import { MemoryNamespace } from "@osva/domain";

import type { memoryNamespaces } from "../schema/memory-namespaces.js";
import { toDomainDate } from "./timestamps.js";

type MemoryNamespaceRow = typeof memoryNamespaces.$inferSelect;

export function memoryNamespaceToRow(namespace: MemoryNamespace) {
  return {
    id: namespace.id,
    workspaceId: namespace.workspaceId,
    key: namespace.key,
    name: namespace.name,
    description: namespace.description ?? null,
    createdAt: namespace.createdAt,
    updatedAt: namespace.updatedAt,
  };
}

export function memoryNamespaceFromRow(
  row: MemoryNamespaceRow,
): MemoryNamespace {
  return MemoryNamespace.create({
    id: row.id as MemoryNamespaceId,
    workspaceId: row.workspaceId as WorkspaceId,
    key: row.key,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: toDomainDate(row.createdAt),
    updatedAt: toDomainDate(row.updatedAt),
  });
}
