import {
  check,
  customType,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { sqlTextInList } from "./sql.js";
import { PERSISTED_COMMUNITY_EDITION_ROLES } from "./states.js";
import { workspaces } from "./workspaces.js";

const bytea = customType<{ data: Buffer; driverData: Buffer | string }>({
  dataType() {
    return "bytea";
  },
  fromDriver(value) {
    if (Buffer.isBuffer(value)) {
      return value;
    }

    if (typeof value === "string" && value.startsWith("\\x")) {
      return Buffer.from(value.slice(2), "hex");
    }

    return Buffer.from(value);
  },
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    role: text("role").notNull(),
    secretDigest: bytea("secret_digest").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    check(
      "api_keys_role_check",
      sql`${table.role} in (${sqlTextInList(PERSISTED_COMMUNITY_EDITION_ROLES)})`,
    ),
  ],
);
