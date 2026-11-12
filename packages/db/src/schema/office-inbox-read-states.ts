import {
  integer,
  pgTable,
  text,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";

import { officeThreads } from "./office-threads.js";
import { workspaces } from "./workspaces.js";

export const officeInboxReadStates = pgTable(
  "office_inbox_read_states",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: text("user_id").notNull(),
    threadId: text("thread_id")
      .notNull()
      .references(() => officeThreads.id),
    lastReadSequence: integer("last_read_sequence").notNull().default(0),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.userId, table.threadId],
      name: "office_inbox_read_states_pk",
    }),
  ],
);
