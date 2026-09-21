export class ConnectorSdkError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    options?: { readonly retryable?: boolean; readonly cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "ConnectorSdkError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

export function rateLimitError(
  message = "Rate limit exceeded.",
): ConnectorSdkError {
  return new ConnectorSdkError("RATE_LIMITED", message, { retryable: true });
}
