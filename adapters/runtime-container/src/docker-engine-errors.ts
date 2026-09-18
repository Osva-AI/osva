export type DockerEngineOperation = "start" | "wait" | "logs";

export class DockerContainerEngineOperationError extends Error {
  readonly operation: DockerEngineOperation;
  readonly containerId: string;

  constructor(
    operation: DockerEngineOperation,
    containerId: string,
    cause: unknown,
  ) {
    super(
      `Docker engine operation "${operation}" failed for container ${containerId}.`,
    );
    this.name = "DockerContainerEngineOperationError";
    this.operation = operation;
    this.containerId = containerId;
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

export class DockerContainerExecutionTimeoutError extends Error {
  constructor(containerId: string) {
    super(`Timed out waiting for container ${containerId}.`);
    this.name = "DockerContainerExecutionTimeoutError";
  }
}
