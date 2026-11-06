export interface ConsoleUpstreamResponse<T> {
  readonly data: T;
  readonly requestId?: string;
  /** Present when the upstream HTTP status must be forwarded (e.g. 422). */
  readonly status?: number;
}

export function upstreamRequestIdHeaders(
  requestId: string | undefined,
): Record<string, string> {
  if (requestId === undefined || requestId.trim().length === 0) {
    return {};
  }
  return { "x-osva-request-id": requestId };
}
