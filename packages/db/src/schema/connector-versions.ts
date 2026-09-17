import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type {
  ConnectorAuthConfig,
  ConnectorTransportConfig,
} from "@osva/contracts";

import { connectors } from "./connectors.js";
import { sqlTextInList } from "./sql.js";
import {
  PERSISTED_CONNECTOR_KINDS,
  PERSISTED_CONNECTOR_TRANSPORTS,
} from "./states.js";

export const connectorVersions = pgTable(
  "connector_versions",
  {
    id: text("id").primaryKey(),
    connectorId: text("connector_id")
      .notNull()
      .references(() => connectors.id),
    version: integer("version").notNull(),
    kind: text("kind").notNull(),
    transport: text("transport").notNull(),
    transportConfig: jsonb("transport_config")
      .$type<ConnectorTransportConfig>()
      .notNull(),
    auth: jsonb("auth").$type<ConnectorAuthConfig>(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    unique("connector_versions_connector_id_version_unique").on(
      table.connectorId,
      table.version,
    ),
    unique("connector_versions_connector_id_id_unique").on(
      table.connectorId,
      table.id,
    ),
    check("connector_versions_version_positive", sql`${table.version} > 0`),
    check(
      "connector_versions_kind_check",
      sql`${table.kind} in (${sqlTextInList(PERSISTED_CONNECTOR_KINDS)})`,
    ),
    check(
      "connector_versions_transport_check",
      sql`${table.transport} in (${sqlTextInList(PERSISTED_CONNECTOR_TRANSPORTS)})`,
    ),
  ],
);
