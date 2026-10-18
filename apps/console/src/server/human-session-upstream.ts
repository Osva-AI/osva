import type { IncomingMessage } from "node:http";

import {
  OSVA_DEFAULT_JSON_BODY_MAX_BYTES,
  OSVA_WORKSPACE_ID_HEADER,
} from "@osva-ai/contracts";
import { OsvaApiError, OsvaTransportError } from "@osva-ai/sdk";

import type { ConsoleConfig } from "./config.js";
import {
  buildForwardSessionCookieHeader,
  sanitizeSessionSetCookieHeaders,
} from "./session-cookie.js";
import type { ConsoleUpstreamResponse } from "./upstream-response.js";

const UPSTREAM_TIMEOUT_MS = 30_000;

export class ConsoleUpstreamHttpError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly requestId?: string;
  readonly setCookie: readonly string[];

  constructor(input: {
    readonly status: number;
    readonly body: Record<string, unknown>;
    readonly requestId?: string;
    readonly setCookie: readonly string[];
  }) {
    super("Upstream request failed.");
    this.name = "ConsoleUpstreamHttpError";
    this.status = input.status;
    this.body = input.body;
    this.requestId = input.requestId;
    this.setCookie = input.setCookie;
  }
}

export interface HumanSessionUpstreamContext {
  readonly incoming: IncomingMessage;
  readonly workspaceId?: string;
}

export interface HumanSessionUpstreamJsonResult<
  T,
> extends ConsoleUpstreamResponse<T> {
  readonly status: number;
  readonly setCookie: readonly string[];
}

export interface HumanSessionUpstreamBinaryResult {
  readonly status: number;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
  readonly requestId?: string;
  readonly setCookie: readonly string[];
}

export function createHumanSessionUpstream(config: ConsoleConfig) {
  const baseUrl = config.osvaBaseUrl.replace(/\/+$/, "");

  return {
    requestJson<T>(
      ctx: HumanSessionUpstreamContext,
      input: {
        readonly method: string;
        readonly path: string;
        readonly query?: Record<string, string | undefined>;
        readonly body?: unknown;
        readonly requireWorkspace?: boolean;
      },
    ): Promise<HumanSessionUpstreamJsonResult<T>> {
      return upstreamJson<T>(baseUrl, ctx, input);
    },

    download(
      ctx: HumanSessionUpstreamContext,
      path: string,
      requireWorkspace = true,
    ): Promise<HumanSessionUpstreamBinaryResult> {
      return upstreamBinary(baseUrl, ctx, path, requireWorkspace);
    },
  };
}

export type HumanSessionUpstream = ReturnType<
  typeof createHumanSessionUpstream
>;

async function upstreamJson<T>(
  baseUrl: string,
  ctx: HumanSessionUpstreamContext,
  input: {
    readonly method: string;
    readonly path: string;
    readonly query?: Record<string, string | undefined>;
    readonly body?: unknown;
    readonly requireWorkspace?: boolean;
  },
): Promise<HumanSessionUpstreamJsonResult<T>> {
  const url = buildUpstreamUrl(baseUrl, input.path, input.query);
  const headers = buildUpstreamHeaders(ctx, input.requireWorkspace ?? true);
  const init: RequestInit = {
    method: input.method,
    headers,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  };
  if (input.body !== undefined) {
    init.body = JSON.stringify(input.body);
    (headers as Record<string, string>)["content-type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new OsvaTransportError(
      error instanceof Error ? error.message : "Upstream fetch failed.",
    );
  }

  const setCookie = sanitizeSessionSetCookieHeaders(
    response.headers.getSetCookie?.() ??
      collectSetCookieFallback(response.headers),
  );
  const requestId = response.headers.get("x-osva-request-id")?.trim();

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text.length === 0 ? null : JSON.parse(text);
  } catch {
    throw new OsvaApiError(response.status, {
      status: "invalid_response",
      message: "Control plane returned non-JSON.",
    });
  }

  if (!response.ok) {
    const body =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : { status: "error", message: "Request failed." };
    throw new ConsoleUpstreamHttpError({
      status: response.status,
      body,
      requestId:
        requestId === undefined || requestId.length === 0
          ? undefined
          : requestId,
      setCookie,
    });
  }

  return {
    status: response.status,
    data: parsed as T,
    requestId:
      requestId === undefined || requestId.length === 0 ? undefined : requestId,
    setCookie,
  };
}

async function upstreamBinary(
  baseUrl: string,
  ctx: HumanSessionUpstreamContext,
  path: string,
  requireWorkspace: boolean,
): Promise<HumanSessionUpstreamBinaryResult> {
  const url = buildUpstreamUrl(baseUrl, path);
  const headers = buildUpstreamHeaders(ctx, requireWorkspace);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    throw new OsvaTransportError(
      error instanceof Error ? error.message : "Upstream fetch failed.",
    );
  }

  const setCookie = sanitizeSessionSetCookieHeaders(
    response.headers.getSetCookie?.() ??
      collectSetCookieFallback(response.headers),
  );
  const requestId = response.headers.get("x-osva-request-id")?.trim();

  if (!response.ok) {
    const text = await response.text();
    let body: Record<string, unknown> = {
      status: "error",
      message: "Request failed.",
    };
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      // keep default body
    }
    throw new ConsoleUpstreamHttpError({
      status: response.status,
      body,
      requestId:
        requestId === undefined || requestId.length === 0
          ? undefined
          : requestId,
      setCookie,
    });
  }

  return {
    status: response.status,
    headers: response.headers,
    body: response.body,
    requestId:
      requestId === undefined || requestId.length === 0 ? undefined : requestId,
    setCookie,
  };
}

function buildUpstreamHeaders(
  ctx: HumanSessionUpstreamContext,
  requireWorkspace: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
  };

  const cookie = buildForwardSessionCookieHeader(ctx.incoming.headers.cookie);
  if (cookie !== undefined) {
    headers.cookie = cookie;
  }

  const origin = headerValue(ctx.incoming.headers.origin);
  if (origin !== undefined) {
    headers.origin = origin;
  }

  if (ctx.workspaceId !== undefined) {
    headers[OSVA_WORKSPACE_ID_HEADER] = ctx.workspaceId;
  } else if (requireWorkspace) {
    const fromBrowser = headerValue(
      ctx.incoming.headers[OSVA_WORKSPACE_ID_HEADER.toLowerCase()],
    );
    if (fromBrowser !== undefined) {
      headers[OSVA_WORKSPACE_ID_HEADER] = fromBrowser;
    }
  }

  return headers;
}

function buildUpstreamUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | undefined>,
): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, `${baseUrl}/`);
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value.length > 0) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}

function collectSetCookieFallback(headers: Headers): string[] {
  const single = headers.get("set-cookie");
  return single === null ? [] : [single];
}

function headerValue(
  value: string | readonly string[] | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const raw = typeof value === "string" ? value : value[0];
  const trimmed = raw?.trim() ?? "";
  return trimmed.length === 0 ? undefined : trimmed;
}

export function assertUpstreamBodyWithinLimit(
  contentLengthHeader: string | undefined,
): void {
  if (contentLengthHeader === undefined) {
    return;
  }
  const length = Number.parseInt(contentLengthHeader, 10);
  if (Number.isFinite(length) && length > OSVA_DEFAULT_JSON_BODY_MAX_BYTES) {
    throw new Error("Request body too large.");
  }
}
