import {
  foreignKey,
  pgTable,
  text,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";

import { workspaces } from "./workspaces.js";

export const officeInboxItemReadStates = pgTable(
  "office_inbox_item_read_states",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    itemId: text("item_id").notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "office_inbox_item_read_states_pk",
      columns: [table.workspaceId, table.userId, table.itemId],
    }),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "office_inbox_item_read_states_workspace_id_fk",
    }),
  ],
);
