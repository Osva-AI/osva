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

import { knowledgeIndexes } from "./knowledge-indexes.js";
import { workspaces } from "./workspaces.js";

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    knowledgeIndexId: text("knowledge_index_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
    textSha256: text("text_sha256").notNull(),
    location: jsonb("location").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "knowledge_chunks_workspace_id_workspaces_id_fk",
    }),
    foreignKey({
      columns: [table.knowledgeIndexId],
      foreignColumns: [knowledgeIndexes.id],
      name: "knowledge_chunks_knowledge_index_id_fk",
    }),
    check("knowledge_chunks_ordinal_non_negative", sql`${table.ordinal} >= 0`),
    uniqueIndex("knowledge_chunks_index_id_ordinal_unique").on(
      table.knowledgeIndexId,
      table.ordinal,
    ),
    index("knowledge_chunks_workspace_id_index_id_idx").on(
      table.workspaceId,
      table.knowledgeIndexId,
    ),
  ],
);
