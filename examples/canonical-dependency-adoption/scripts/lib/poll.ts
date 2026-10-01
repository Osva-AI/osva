export class SetupPollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupPollError";
  }
}

export interface PollOptions<T> {
  readonly label: string;
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly fetch: () => Promise<T>;
  readonly getStatus: (value: T) => string;
  readonly isReady: (value: T) => boolean;
  readonly isFailed: (value: T) => boolean;
  readonly onStatus?: (status: string) => void;
}

export async function pollUntilReady<T>(options: PollOptions<T>): Promise<T> {
  const started = Date.now();
  let lastStatus: string | undefined;

  while (Date.now() - started < options.timeoutMs) {
    const value = await options.fetch();
    const status = options.getStatus(value);
    if (status !== lastStatus) {
      options.onStatus?.(status);
      lastStatus = status;
    }

    if (options.isFailed(value)) {
      throw new SetupPollError(
        `${options.label} failed with status '${status}'.`,
      );
    }

    if (options.isReady(value)) {
      return value;
    }

    await sleep(options.intervalMs);
  }

  throw new SetupPollError(
    `${options.label} timed out after ${options.timeoutMs}ms (last status: ${lastStatus ?? "unknown"}).`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
