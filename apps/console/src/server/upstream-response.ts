export interface ConsoleUpstreamResponse<T> {
  readonly data: T;
  readonly requestId?: string;
}

export function upstreamRequestIdHeaders(
  requestId: string | undefined,
): Record<string, string> {
  if (requestId === undefined || requestId.trim().length === 0) {
    return {};
  }
  return { "x-osva-request-id": requestId };
}
