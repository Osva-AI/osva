export class JobQueueShutdownError extends Error {
  constructor(operation: string) {
    super(`MemoryJobQueue cannot ${operation} after shutdown.`);
    this.name = "JobQueueShutdownError";
  }
}

export class SecretNotFoundError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`Secret '${key}' was not found.`);
    this.name = "SecretNotFoundError";
    this.key = key;
  }
}
