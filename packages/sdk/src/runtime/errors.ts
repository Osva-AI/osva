export class RuntimeExecutionError extends Error {
  readonly code: string;

  constructor(message: string, code = "AGENT_EXECUTION_FAILED") {
    super(message);
    this.name = "RuntimeExecutionError";
    this.code = code;
  }
}

export class RuntimeCapabilityError extends Error {
  readonly code: string;

  constructor(
    message: string,
    code = "RUNTIME_PROTOCOL_FAILURE",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "RuntimeCapabilityError";
    this.code = code;
  }
}

export class RuntimeProtocolError extends Error {
  readonly code: string;

  constructor(message: string, code = "RUNTIME_PROTOCOL_FAILURE") {
    super(message);
    this.name = "RuntimeProtocolError";
    this.code = code;
  }
}
