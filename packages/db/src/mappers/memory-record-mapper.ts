import type { JsonValue, MemoryNamespaceId } from "@osva/contracts";
import { MemoryRecord } from "@osva/domain";

import type { memoryRecords } from "../schema/memory-records.js";
import { toDomainDate } from "./timestamps.js";

type MemoryRecordRow = typeof memoryRecords.$inferSelect;

export function memoryRecordToRow(record: MemoryRecord) {
  return {
    namespaceId: record.namespaceId,
    key: record.key,
    value: record.value,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function memoryRecordFromRow(row: MemoryRecordRow): MemoryRecord {
  return MemoryRecord.create({
    namespaceId: row.namespaceId as MemoryNamespaceId,
    key: row.key,
    value: row.value as JsonValue,
    revision: row.revision,
    createdAt: toDomainDate(row.createdAt),
    updatedAt: toDomainDate(row.updatedAt),
  });
}
