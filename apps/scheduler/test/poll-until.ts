/** Default poll budget for integration tests (below Vitest integration timeout). */
export const DEFAULT_INTEGRATION_POLL_TIMEOUT_MS = 90_000;

const DEFAULT_POLL_INTERVAL_MS = 100;

export interface PollUntilOptions {
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly label?: string;
  readonly onTimeout?: () => Promise<unknown> | unknown;
}

export async function pollUntil(
  check: () => Promise<boolean>,
  options: PollUntilOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_INTEGRATION_POLL_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const label = options.label ?? "condition";
  const deadline = performance.now() + timeoutMs;

  while (performance.now() < deadline) {
    if (await check()) {
      return;
    }
    await sleep(pollIntervalMs);
  }

  let diagnostics: unknown;
  if (options.onTimeout !== undefined) {
    try {
      diagnostics = await options.onTimeout();
    } catch (error) {
      diagnostics = {
        onTimeoutError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const message =
    diagnostics === undefined
      ? `Timed out after ${String(timeoutMs)}ms waiting for ${label}.`
      : `Timed out after ${String(timeoutMs)}ms waiting for ${label}. Last observed state: ${JSON.stringify(diagnostics)}`;

  throw new Error(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
