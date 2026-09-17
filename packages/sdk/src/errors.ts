export interface OsvaApiErrorBody {
  readonly status: string;
  readonly [key: string]: unknown;
}

export class OsvaApiError extends Error {
  readonly status: number;
  readonly body: OsvaApiErrorBody;

  constructor(status: number, body: OsvaApiErrorBody) {
    super(formatApiErrorMessage(status, body));
    this.name = "OsvaApiError";
    this.status = status;
    this.body = body;
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
  return `OSVA API request failed with HTTP ${String(status)} (${domain}).`;
}
