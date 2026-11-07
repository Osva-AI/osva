import type {
  BuilderPublicationId,
  BuilderPublicationReceiptV1,
} from "@osva/domain/builder";
import type { BuilderPublicationRecordV1 } from "@osva/domain";

import type { builderPublications } from "../schema/builder-publications.js";

type BuilderPublicationRow = typeof builderPublications.$inferSelect;

export function builderPublicationToRow(
  record: BuilderPublicationRecordV1,
): typeof builderPublications.$inferInsert {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    idempotencyKey: record.idempotencyKey,
    planDigest: record.planDigest,
    receipt: record.receipt as unknown as Record<string, unknown>,
    createdAt: record.createdAt,
  };
}

export function builderPublicationFromRow(
  row: BuilderPublicationRow,
): BuilderPublicationRecordV1 {
  return {
    id: row.id as BuilderPublicationId,
    workspaceId: row.workspaceId,
    idempotencyKey: row.idempotencyKey,
    planDigest: row.planDigest,
    receipt: row.receipt as unknown as BuilderPublicationReceiptV1,
    createdAt: row.createdAt,
  };
}
