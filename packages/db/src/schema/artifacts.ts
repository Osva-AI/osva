import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { runAttempts } from "./run-attempts.js";
import { runs } from "./runs.js";
import { workspaces } from "./workspaces.js";

export const artifacts = pgTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    mediaType: text("media_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    digestSha256: text("digest_sha256").notNull(),
    metadata: jsonb("metadata")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    producerRunId: text("producer_run_id"),
    producerRunAttemptId: text("producer_run_attempt_id"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "artifacts_workspace_id_workspaces_id_fk",
    }),
    foreignKey({
      columns: [table.producerRunId],
      foreignColumns: [runs.id],
      name: "artifacts_producer_run_id_runs_id_fk",
    }),
    foreignKey({
      columns: [table.producerRunId, table.producerRunAttemptId],
      foreignColumns: [runAttempts.runId, runAttempts.id],
      name: "artifacts_producer_run_attempt_fk",
    }),
    check("artifacts_size_bytes_non_negative", sql`${table.sizeBytes} >= 0`),
    check(
      "artifacts_producer_pair_consistency",
      sql`(${table.producerRunId} is null and ${table.producerRunAttemptId} is null) or (${table.producerRunId} is not null and ${table.producerRunAttemptId} is not null)`,
    ),
    uniqueIndex("artifacts_workspace_id_idempotency_key_unique")
      .on(table.workspaceId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    index("artifacts_workspace_id_created_at_id_idx").on(
      table.workspaceId,
      table.createdAt,
      table.id,
    ),
    index("artifacts_producer_run_id_created_at_id_idx").on(
      table.producerRunId,
      table.createdAt,
      table.id,
    ),
    index("artifacts_producer_run_attempt_id_created_at_id_idx").on(
      table.producerRunAttemptId,
      table.createdAt,
      table.id,
    ),
    index("artifacts_workspace_id_digest_sha256_idx").on(
      table.workspaceId,
      table.digestSha256,
    ),
  ],
);
