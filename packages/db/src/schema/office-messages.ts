import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { officeThreads } from "./office-threads.js";
import { workspaces } from "./workspaces.js";

export const officeMessages = pgTable(
  "office_messages",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    threadId: text("thread_id")
      .notNull()
      .references(() => officeThreads.id),
    sequence: integer("sequence").notNull(),
    authorType: text("author_type").notNull(),
    authorUserId: text("author_user_id"),
    authorOfficeWorkerId: text("author_office_worker_id"),
    body: text("body").notNull(),
    parentMessageId: text("parent_message_id"),
    mentions: jsonb("mentions").notNull().default([]),
    resourceReferences: jsonb("resource_references").notNull().default([]),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    unique("office_messages_thread_id_sequence_unique").on(
      table.threadId,
      table.sequence,
    ),
    unique("office_messages_workspace_thread_idempotency_unique").on(
      table.workspaceId,
      table.threadId,
      table.idempotencyKey,
    ),
    unique("office_messages_workspace_id_id_unique").on(
      table.workspaceId,
      table.id,
    ),
  ],
);
