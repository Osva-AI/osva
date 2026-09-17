import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { MemoryNamespaceBinding } from "@osva/contracts";

import { agentVersions } from "./agent-versions.js";
import { agents } from "./agents.js";
import { sqlTextInList } from "./sql.js";
import { PERSISTED_RUN_STATES } from "./states.js";

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    agentId: text("agent_id").notNull(),
    status: text("status").notNull(),
    agentVersionId: text("agent_version_id").notNull(),
    modelProfileVersionBindings: jsonb("model_profile_version_bindings")
      .$type<Readonly<Record<string, string>>>()
      .notNull(),
    toolVersionBindings: jsonb("tool_version_bindings")
      .$type<Readonly<Record<string, string>>>()
      .notNull()
      .default({}),
    memoryNamespaceBindings: jsonb("memory_namespace_bindings")
      .$type<Readonly<Record<string, MemoryNamespaceBinding>>>()
      .notNull()
      .default({}),
    evaluationRunId: text("evaluation_run_id"),
    evaluationCaseId: text("evaluation_case_id"),
    input: jsonb("input").notNull(),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.agentId],
      foreignColumns: [agents.workspaceId, agents.id],
      name: "runs_workspace_id_agent_id_agents_fk",
    }),
    foreignKey({
      columns: [table.agentId, table.agentVersionId],
      foreignColumns: [agentVersions.agentId, agentVersions.id],
      name: "runs_agent_id_agent_version_id_agent_versions_fk",
    }),
    uniqueIndex("runs_workspace_id_idempotency_key_unique")
      .on(table.workspaceId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    index("runs_created_at_id_idx").on(table.createdAt, table.id),
    index("runs_agent_id_created_at_id_idx").on(
      table.agentId,
      table.createdAt,
      table.id,
    ),
    index("runs_agent_version_id_created_at_id_idx").on(
      table.agentVersionId,
      table.createdAt,
      table.id,
    ),
    index("runs_status_created_at_id_idx").on(
      table.status,
      table.createdAt,
      table.id,
    ),
    check(
      "runs_status_check",
      sql`${table.status} in (${sqlTextInList(PERSISTED_RUN_STATES)})`,
    ),
  ],
);
