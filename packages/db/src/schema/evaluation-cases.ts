import { jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import type { EvaluatorConfig } from "@osva/contracts";
import type { JsonValue } from "@osva/contracts";

import { evaluationSuiteVersions } from "./evaluation-suite-versions.js";

export const evaluationCases = pgTable(
  "evaluation_cases",
  {
    id: text("id").primaryKey(),
    evaluationSuiteVersionId: text("evaluation_suite_version_id")
      .notNull()
      .references(() => evaluationSuiteVersions.id),
    key: text("key").notNull(),
    name: text("name"),
    input: jsonb("input").$type<JsonValue>().notNull(),
    expected: jsonb("expected").$type<JsonValue>(),
    evaluator: jsonb("evaluator").$type<EvaluatorConfig>().notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    unique("evaluation_cases_version_id_key_unique").on(
      table.evaluationSuiteVersionId,
      table.key,
    ),
    unique("evaluation_cases_version_id_id_unique").on(
      table.evaluationSuiteVersionId,
      table.id,
    ),
  ],
);
