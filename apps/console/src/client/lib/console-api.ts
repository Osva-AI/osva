import { getSelectedWorkspaceId } from "./workspace-selection.js";

export interface ConsoleApiErrorBody {
  readonly error: string;
  readonly code?: string;
  readonly requestId?: string;
  readonly message?: string;
  readonly [key: string]: unknown;
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

/** Workspace pinned when a mutation or fetch begins (before async work). */
export function workspaceIdForRequest(pinned?: string): string | undefined {
  return pinned ?? getSelectedWorkspaceId();
}

/** Read/query calls: pin to the workspace encoded in the React Query key. */
export function workspaceScopedFetch<T>(
  workspaceId: string | undefined,
  path: string,
  init?: RequestInit,
  options?: { readonly acceptErrorStatuses?: readonly number[] },
): Promise<T> {
  return consoleFetch<T>(path, init, {
    ...options,
    workspaceId,
  });
}

/** Mutations: capture workspace at user action time (start of mutationFn). */
export function workspaceMutationFetch<T>(
  path: string,
  init?: RequestInit,
  options?: {
    readonly acceptErrorStatuses?: readonly number[];
    readonly workspaceId?: string;
  },
): Promise<T> {
  const pinned = options?.workspaceId ?? workspaceIdForRequest();
  return consoleFetch<T>(path, init, {
    ...options,
    workspaceId: pinned,
  });
}

function buildHeaders(init?: HeadersInit, workspaceId?: string): Headers {
  const headers = new Headers(init);
  if (!headers.has("accept")) {
    headers.set("accept", "application/json");
  }
  const resolved = workspaceIdForRequest(workspaceId);
  if (resolved !== undefined) {
    headers.set("x-osva-workspace-id", resolved);
  }
  return headers;
}

export async function consoleFetch<T>(
  path: string,
  init?: RequestInit,
  options?: {
    readonly acceptErrorStatuses?: readonly number[];
    /** Pin workspace for the entire request (mutations should set at action start). */
    readonly workspaceId?: string;
  },
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: buildHeaders(init?.headers, options?.workspaceId),
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

  const accept = new Set(options?.acceptErrorStatuses ?? []);
  if (!response.ok && !accept.has(response.status)) {
    const parsed =
      typeof body === "object" && body !== null
        ? (body as ConsoleApiErrorBody)
        : { error: "Request failed." };
    const headerRequestId = response.headers.get("x-osva-request-id")?.trim();
    const message =
      typeof parsed.error === "string"
        ? parsed.error
        : typeof (body as { message?: unknown }).message === "string"
          ? String((body as { message?: string }).message)
          : "Request failed.";
    throw new ConsoleApiError(response.status, {
      ...parsed,
      error: message,
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
