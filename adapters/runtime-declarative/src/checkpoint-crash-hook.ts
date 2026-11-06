/** Non-zero exit used by process-crash acceptance tests (128 + SIGKILL). */
export const CHECKPOINT_CRASH_EXIT_CODE = 137;

export const CHECKPOINT_CRASH_PHASES = [
  "during_model_invocation",
  "after_operation_pending",
  "after_tool_journal_commit",
  "after_tool_checkpoint",
] as const;

export type CheckpointCrashPhase = (typeof CHECKPOINT_CRASH_PHASES)[number];

let crashPhaseOverride: string | undefined;

export function setCheckpointCrashPhaseOverride(
  phase: string | undefined,
): void {
  crashPhaseOverride = phase;
}

export function crashIfRequested(phase: CheckpointCrashPhase): void {
  const active = crashPhaseOverride ?? process.env.OSVA_CHECKPOINT_CRASH_AT;
  if (active === phase) {
    process.exit(CHECKPOINT_CRASH_EXIT_CODE);
  }
}
