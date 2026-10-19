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
  ModelProviderConnectionEndpoint,
  SecretReference,
} from "@osva-ai/contracts";

import { modelProviderConnections } from "./model-provider-connections.js";

export const modelProviderConnectionVersions = pgTable(
  "model_provider_connection_versions",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => modelProviderConnections.id),
    version: integer("version").notNull(),
    endpoint: jsonb("endpoint").$type<ModelProviderConnectionEndpoint>(),
    credentialRef: jsonb("credential_ref").$type<SecretReference>(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    unique(
      "model_provider_connection_versions_connection_id_version_unique",
    ).on(table.connectionId, table.version),
    unique("model_provider_connection_versions_connection_id_id_unique").on(
      table.connectionId,
      table.id,
    ),
    check(
      "model_provider_connection_versions_version_positive",
      sql`${table.version} > 0`,
    ),
  ],
);
