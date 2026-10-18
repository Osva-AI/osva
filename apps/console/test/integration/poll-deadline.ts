export interface PollResult {
  readonly done: boolean;
  readonly lastState?: unknown;
}

export async function pollUntil(options: {
  readonly label: string;
  readonly deadlineMs: number;
  readonly intervalMs?: number;
  readonly probe: () => Promise<PollResult>;
}): Promise<void> {
  const started = Date.now();
  const intervalMs = options.intervalMs ?? 100;
  let attempts = 0;
  let lastState: unknown;

  while (Date.now() - started < options.deadlineMs) {
    attempts += 1;
    const result = await options.probe();
    lastState = result.lastState ?? lastState;
    if (result.done) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }

  const elapsedMs = Date.now() - started;
  throw new Error(
    `${options.label} timed out after ${String(elapsedMs)}ms (${String(attempts)} attempts). Last state: ${JSON.stringify(lastState)}`,
  );
}
