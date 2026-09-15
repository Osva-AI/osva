export const RUN_STEP_KINDS = ["MODEL", "TOOL"] as const;

export type RunStepKind = (typeof RUN_STEP_KINDS)[number];

export const RUN_STEP_STATUSES = ["RUNNING", "SUCCEEDED", "FAILED"] as const;

export type RunStepStatus = (typeof RUN_STEP_STATUSES)[number];

export function isRunStepKind(value: string): value is RunStepKind {
  return (RUN_STEP_KINDS as readonly string[]).includes(value);
}

export function isRunStepStatus(value: string): value is RunStepStatus {
  return (RUN_STEP_STATUSES as readonly string[]).includes(value);
}
