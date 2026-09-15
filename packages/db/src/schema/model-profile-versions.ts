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
import type { ModelProfileVersionPricing } from "@osva/contracts";

import { modelProfiles } from "./model-profiles.js";
import { sqlTextInList } from "./sql.js";
import { PERSISTED_MODEL_PROVIDERS } from "./states.js";

export const modelProfileVersions = pgTable(
  "model_profile_versions",
  {
    id: text("id").primaryKey(),
    modelProfileId: text("model_profile_id")
      .notNull()
      .references(() => modelProfiles.id),
    version: integer("version").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    pricing: jsonb("pricing").$type<ModelProfileVersionPricing>(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    unique("model_profile_versions_model_profile_id_version_unique").on(
      table.modelProfileId,
      table.version,
    ),
    unique("model_profile_versions_model_profile_id_id_unique").on(
      table.modelProfileId,
      table.id,
    ),
    check("model_profile_versions_version_positive", sql`${table.version} > 0`),
    check(
      "model_profile_versions_provider_check",
      sql`${table.provider} in (${sqlTextInList(PERSISTED_MODEL_PROVIDERS)})`,
    ),
  ],
);
