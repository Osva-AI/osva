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
import type {
  DeclarativeRuntimeCheckpointStateV1,
  RunCheckpointBindingIdentity,
  RunCheckpointCursorV1,
} from "@osva-ai/contracts";

import { runAttempts } from "./run-attempts.js";
import { runs } from "./runs.js";
import { workspaces } from "./workspaces.js";

export const runCheckpoints = pgTable(
  "run_checkpoints",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    runId: text("run_id").notNull(),
    sequence: integer("sequence").notNull(),
    runAttemptId: text("run_attempt_id").notNull(),
    executionGeneration: integer("execution_generation").notNull(),
    runtimeKind: text("runtime_kind").notNull(),
    envelopeVersion: text("envelope_version").notNull(),
    stateSchemaVersion: text("state_schema_version").notNull(),
    agentVersionId: text("agent_version_id").notNull(),
    bindingIdentity: jsonb("binding_identity")
      .$type<RunCheckpointBindingIdentity>()
      .notNull(),
    bindingDigest: text("binding_digest").notNull(),
    cursor: jsonb("cursor").$type<RunCheckpointCursorV1>().notNull(),
    state: jsonb("state")
      .$type<DeclarativeRuntimeCheckpointStateV1>()
      .notNull(),
    payloadDigest: text("payload_digest").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "run_checkpoints_workspace_id_workspaces_id_fk",
    }),
    foreignKey({
      columns: [table.runId],
      foreignColumns: [runs.id],
      name: "run_checkpoints_run_id_runs_id_fk",
    }),
    foreignKey({
      columns: [table.runId, table.runAttemptId],
      foreignColumns: [runAttempts.runId, runAttempts.id],
      name: "run_checkpoints_run_attempt_fk",
    }),
    uniqueIndex("run_checkpoints_run_id_sequence_unique").on(
      table.runId,
      table.sequence,
    ),
    uniqueIndex("run_checkpoints_run_id_idempotency_key_unique").on(
      table.runId,
      table.idempotencyKey,
    ),
    index("run_checkpoints_run_id_sequence_desc_idx").on(
      table.runId,
      table.sequence,
    ),
    check("run_checkpoints_sequence_positive", sql`${table.sequence} > 0`),
    check(
      "run_checkpoints_runtime_kind_check",
      sql`${table.runtimeKind} = 'DECLARATIVE'`,
    ),
  ],
);
