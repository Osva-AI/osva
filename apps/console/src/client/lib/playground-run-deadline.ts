export const PLAYGROUND_RUN_DEADLINE_MS = 120_000;

export function isPlaygroundRunDeadlineExceeded(deadlineMs: number): boolean {
  return Date.now() >= deadlineMs;
}

export function createPlaygroundRunDeadline(): number {
  return Date.now() + PLAYGROUND_RUN_DEADLINE_MS;
}
