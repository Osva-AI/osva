/**
 * Deterministic acceptance fixture: holds execution until the hold window elapses.
 * Used to observe RUNNING + execution lease before worker SIGKILL.
 */
export async function run(): Promise<{ readonly heldMs: number }> {
  const holdMs = 90_000;
  const started = Date.now();
  while (Date.now() - started < holdMs) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { heldMs: Date.now() - started };
}
