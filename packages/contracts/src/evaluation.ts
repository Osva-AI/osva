import type { JsonValue } from "./json-value.js";

export const EVALUATOR_TYPES = ["JSON_EXACT_MATCH"] as const;

export type EvaluatorType = (typeof EVALUATOR_TYPES)[number];

export function isEvaluatorType(value: string): value is EvaluatorType {
  return (EVALUATOR_TYPES as readonly string[]).includes(value);
}

export interface JsonExactMatchEvaluatorConfig {
  readonly type: "JSON_EXACT_MATCH";
  readonly expected: JsonValue;
}

export type EvaluatorConfig = JsonExactMatchEvaluatorConfig;
