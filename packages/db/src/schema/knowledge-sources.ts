import {
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { artifacts } from "./artifacts.js";
import { workspaces } from "./workspaces.js";

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    artifactId: text("artifact_id").notNull(),
    attributes: jsonb("attributes")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
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
      name: "knowledge_sources_workspace_id_workspaces_id_fk",
    }),
    foreignKey({
      columns: [table.artifactId],
      foreignColumns: [artifacts.id],
      name: "knowledge_sources_artifact_id_artifacts_id_fk",
    }),
    uniqueIndex("knowledge_sources_workspace_id_key_unique").on(
      table.workspaceId,
      table.key,
    ),
    uniqueIndex("knowledge_sources_workspace_id_idempotency_key_unique")
      .on(table.workspaceId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    index("knowledge_sources_workspace_id_created_at_id_idx").on(
      table.workspaceId,
      table.createdAt,
      table.id,
    ),
  ],
);
