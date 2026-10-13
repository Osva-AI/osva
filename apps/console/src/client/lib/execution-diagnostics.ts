export type RunAttemptExecutionState =
  | "queued"
  | "running_leased"
  | "running_lease_expired"
  | "running_unleased"
  | "interrupted"
  | "failed"
  | "completed"
  | "cancelled"
  | "timed_out";

export interface RunAttemptExecutionDiagnostics {
  readonly state: RunAttemptExecutionState | string;
  readonly leased: boolean;
  readonly leaseExpiresAt?: string;
  readonly executionGeneration: number;
  readonly interrupted: boolean;
  readonly recoveryReason?: string;
  readonly observedAt: string;
}

const STATE_LABELS: Readonly<Record<string, string>> = {
  queued: "Queued",
  running_leased: "Running with an active lease",
  running_lease_expired: "Running but lease expired",
  running_unleased: "Running (no execution lease)",
  interrupted: "Execution interrupted",
  failed: "Failed",
  completed: "Completed",
  cancelled: "Cancelled",
  timed_out: "Timed out",
};

export function executionStateLabel(state: string): string {
  return STATE_LABELS[state] ?? state;
}
