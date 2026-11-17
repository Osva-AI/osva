import type { EvaluatorConfig } from "./evaluation.js";
import { evaluatorConfigSchema } from "./schemas/evaluation.js";

export function parseEvaluatorConfig(value: unknown): EvaluatorConfig {
  return evaluatorConfigSchema.parse(value);
}

export function safeParseEvaluatorConfig(value: unknown) {
  return evaluatorConfigSchema.safeParse(value);
}
