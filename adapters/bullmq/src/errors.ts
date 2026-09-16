export class JobQueueShutdownError extends Error {
  constructor(operation: string) {
    super(`BullMqJobQueue cannot ${operation} after shutdown.`);
    this.name = "JobQueueShutdownError";
  }
}

export class UnsupportedQueueJobError extends Error {
  constructor(jobName: string) {
    super(`Unsupported queue job name '${jobName}'.`);
    this.name = "UnsupportedQueueJobError";
  }
}

export class InvalidQueuePayloadError extends Error {
  constructor() {
    super("Queue payload must be exactly { runAttemptId }.");
    this.name = "InvalidQueuePayloadError";
  }
}

export class ValkeyUnavailableError extends Error {
  constructor() {
    super("Valkey is unavailable.");
    this.name = "ValkeyUnavailableError";
  }
}
