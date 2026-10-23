import {
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type {
  EvaluationQualityGateAssessmentV1,
  EvaluationQualityGatePolicyV1,
} from "@osva-ai/contracts";

import { evaluationRuns } from "./evaluation-runs.js";

export const evaluationRunGateAssessments = pgTable(
  "evaluation_run_gate_assessments",
  {
    evaluationRunId: text("evaluation_run_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    policySnapshot: jsonb("policy_snapshot")
      .$type<EvaluationQualityGatePolicyV1>()
      .notNull(),
    assessment: jsonb("assessment")
      .$type<EvaluationQualityGateAssessmentV1>()
      .notNull(),
    assessedAt: timestamp("assessed_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.evaluationRunId],
      foreignColumns: [evaluationRuns.id],
      name: "evaluation_run_gate_assessments_evaluation_run_id_fk",
    }),
  ],
);
