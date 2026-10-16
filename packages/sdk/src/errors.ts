export interface OsvaApiErrorBody {
  readonly status: string;
  readonly [key: string]: unknown;
}

/** Control-plane `/v1` error. HTTP 429 `RATE_LIMITED` is not retried by this SDK. */
export class OsvaApiError extends Error {
  readonly status: number;
  readonly body: OsvaApiErrorBody;
  readonly requestId?: string;

  constructor(status: number, body: OsvaApiErrorBody, requestId?: string) {
    super(formatApiErrorMessage(status, body));
    this.name = "OsvaApiError";
    this.status = status;
    this.body = body;
    this.requestId = requestId;
  }
}

export class OsvaTransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OsvaTransportError";
  }
}

function formatApiErrorMessage(status: number, body: OsvaApiErrorBody): string {
  const domain = typeof body.status === "string" ? body.status : "error";
  const code =
    typeof body.code === "string" && body.code.length > 0
      ? body.code
      : undefined;
  const detail =
    typeof body.message === "string" && body.message.length > 0
      ? body.message
      : undefined;

  const parts = [
    `OSVA API request failed with HTTP ${String(status)} (${domain})`,
  ];
  if (code !== undefined) {
    parts.push(`code=${code}`);
  }
  if (detail !== undefined) {
    parts.push(detail);
  }
  const sentence = parts.join(": ");
  return sentence.endsWith(".") ? sentence : `${sentence}.`;
}
