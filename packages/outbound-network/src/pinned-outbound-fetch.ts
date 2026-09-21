import {
  REMOTE_HTTP_FORBIDDEN_DESTINATION_MESSAGE,
  resolveRemoteHttpConnectionTarget,
  type HostnameLookup,
  type RemoteHttpOutboundNetworkPolicy,
} from "./outbound-network.js";
import {
  fetchWithPinnedConnection,
  type PinnedFetchInit,
} from "./pinned-fetch.js";

export interface PinnedOutboundFetchPolicy extends RemoteHttpOutboundNetworkPolicy {
  readonly forbiddenDestinationMessage?: string;
}

const MCP_REDIRECT_MESSAGE =
  "Outbound HTTP redirects are not permitted for MCP connectors.";

const BLOCKED_REQUEST_HEADERS = new Set(
  [
    "host",
    "content-length",
    "connection",
    "transfer-encoding",
    "upgrade",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
  ].map((name) => name.toLowerCase()),
);

export type PinnedOutboundFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function createPinnedOutboundFetch(
  policy: PinnedOutboundFetchPolicy,
): PinnedOutboundFetch {
  const forbiddenMessage =
    policy.forbiddenDestinationMessage ??
    REMOTE_HTTP_FORBIDDEN_DESTINATION_MESSAGE;

  return async (input, init) => {
    const request = toRequest(input, init);
    const target = await resolveRemoteHttpConnectionTarget(request.url, policy);

    if (target.kind === "invalid_endpoint") {
      throw new OutboundNetworkPolicyError(
        "Outbound destination URL is invalid.",
      );
    }

    if (target.kind === "forbidden_destination") {
      throw new OutboundNetworkPolicyError(forbiddenMessage);
    }

    const headers = filterHeaders(request.headers);
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? ""
        : await request.text();

    const response = await fetchWithPinnedConnection(
      {
        url: target.url,
        hostname: target.hostname,
        address: target.pinnedAddress,
      },
      {
        method: request.method,
        headers,
        body,
        signal: request.signal ?? undefined,
      } satisfies PinnedFetchInit,
    );

    if (response.status >= 300 && response.status < 400) {
      throw new OutboundNetworkPolicyError(MCP_REDIRECT_MESSAGE);
    }

    return response;
  };
}

export class OutboundNetworkPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundNetworkPolicyError";
  }
}

function toRequest(input: string | URL | Request, init?: RequestInit): Request {
  if (input instanceof Request) {
    if (init !== undefined) {
      return new Request(input, init);
    }
    return input;
  }

  return new Request(input, init);
}

function filterHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (BLOCKED_REQUEST_HEADERS.has(key.toLowerCase())) {
      return;
    }
    result[key] = value;
  });
  return result;
}

export type { HostnameLookup };
