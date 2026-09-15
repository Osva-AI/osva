import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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
    check(
      "runs_status_check",
      sql`${table.status} in (${sqlTextInList(PERSISTED_RUN_STATES)})`,
    ),
  ],
);
