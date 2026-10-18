import { getSelectedWorkspaceId } from "./workspace-selection.js";

export interface ConsoleApiErrorBody {
  readonly error: string;
  readonly code?: string;
  readonly requestId?: string;
}

export class ConsoleApiError extends Error {
  readonly status: number;
  readonly body: ConsoleApiErrorBody;

  constructor(status: number, body: ConsoleApiErrorBody) {
    super(body.error);
    this.name = "ConsoleApiError";
    this.status = status;
    this.body = body;
  }
}

function buildHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  if (!headers.has("accept")) {
    headers.set("accept", "application/json");
  }
  const workspaceId = getSelectedWorkspaceId();
  if (workspaceId !== undefined) {
    headers.set("x-osva-workspace-id", workspaceId);
  }
  return headers;
}

export async function consoleFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: buildHeaders(init?.headers),
  });

  if (response.status === 204) {
    return undefined as T;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ConsoleApiError(response.status, {
      error: "Console returned a non-JSON response.",
    });
  }

  if (!response.ok) {
    const parsed =
      typeof body === "object" && body !== null
        ? (body as ConsoleApiErrorBody)
        : { error: "Request failed." };
    const headerRequestId = response.headers.get("x-osva-request-id")?.trim();
    throw new ConsoleApiError(response.status, {
      ...parsed,
      requestId: parsed.requestId ?? headerRequestId,
    });
  }

  return body as T;
}

export interface ConsoleDownloadResult {
  readonly status: number;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
}

export async function consoleDownload(
  path: string,
  init?: RequestInit,
): Promise<ConsoleDownloadResult> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: buildHeaders(init?.headers),
  });

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ConsoleApiError(response.status, {
        error: "Console returned a non-JSON error response.",
      });
    }

    const parsed =
      typeof body === "object" && body !== null
        ? (body as ConsoleApiErrorBody)
        : { error: "Request failed." };
    const headerRequestId = response.headers.get("x-osva-request-id")?.trim();
    throw new ConsoleApiError(response.status, {
      ...parsed,
      requestId: parsed.requestId ?? headerRequestId,
    });
  }

  return {
    status: response.status,
    headers: response.headers,
    body: response.body,
  };
}
