/**
 * Persisted Stage 0 state values. These must stay identical to
 * `RUN_STATES` and `RUN_ATTEMPT_STATES` in `@osva/contracts`.
 *
 * They are duplicated here so Drizzle Kit can load the schema without
 * resolving workspace package exports.
 */
export const PERSISTED_RUN_STATES = [
  "PENDING",
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
] as const;

export const PERSISTED_RUN_ATTEMPT_STATES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
] as const;

export const PERSISTED_MODEL_PROVIDERS = ["OPENAI"] as const;

export const PERSISTED_TOOL_TYPES = ["INTERNAL"] as const;

export const PERSISTED_RUN_STEP_KINDS = ["MODEL", "TOOL"] as const;

export const PERSISTED_RUN_STEP_STATUSES = [
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
] as const;

export const PERSISTED_EVALUATOR_TYPES = ["JSON_EXACT_MATCH"] as const;

export const PERSISTED_WORKFLOW_RUN_STATES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
] as const;

export const PERSISTED_WORKFLOW_NODE_RUN_STATES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
] as const;
