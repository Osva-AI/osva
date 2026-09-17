import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { JsonValue } from "@osva/contracts";

import { memoryNamespaces } from "./memory-namespaces.js";

export const memoryRecords = pgTable(
  "memory_records",
  {
    namespaceId: text("namespace_id")
      .notNull()
      .references(() => memoryNamespaces.id),
    key: text("key").notNull(),
    value: jsonb("value").$type<JsonValue>().notNull(),
    revision: integer("revision").notNull(),
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
    primaryKey({
      columns: [table.namespaceId, table.key],
      name: "memory_records_pkey",
    }),
    check("memory_records_revision_positive", sql`${table.revision} > 0`),
  ],
);
