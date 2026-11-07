import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { workspaces } from "./workspaces.js";

export const builderPublications = pgTable(
  "builder_publications",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    planDigest: text("plan_digest").notNull(),
    receipt: jsonb("receipt").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "builder_publications_workspace_id_workspaces_id_fk",
    }),
    unique("builder_publications_workspace_id_idempotency_key_unique").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    check(
      "builder_publications_idempotency_key_nonempty",
      sql`char_length(${table.idempotencyKey}) > 0`,
    ),
    check(
      "builder_publications_plan_digest_nonempty",
      sql`char_length(${table.planDigest}) > 0`,
    ),
  ],
);
