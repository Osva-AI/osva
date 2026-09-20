import { OsvaApiError, OsvaTransportError } from "./errors.js";

export interface OsvaHttpClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

export interface RequestOptions {
  readonly method: "GET" | "POST" | "PATCH";
  readonly path: string;
  readonly query?: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface UploadMultipartOptions {
  readonly path: string;
  readonly form: FormData;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface DownloadOptions {
  readonly path: string;
  readonly query?: Readonly<Record<string, string | undefined>>;
}

export interface DownloadResult {
  readonly status: number;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
}

export class OsvaHttpClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OsvaHttpClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const url = buildUrl(this.baseUrl, options.path, options.query);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method,
        signal: controller.signal,
        headers:
          options.body === undefined
            ? options.headers
            : {
                "content-type": "application/json",
                ...options.headers,
              },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new OsvaTransportError("OSVA API request timed out.", {
          cause: error,
        });
      }
      throw new OsvaTransportError("OSVA API transport failed.", {
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new OsvaTransportError("OSVA API returned a non-JSON response.", {
        cause: error,
      });
    }

    if (!response.ok) {
      throw new OsvaApiError(response.status, normalizeErrorBody(body));
    }

    return body as T;
  }

  async uploadMultipart<T>(options: UploadMultipartOptions): Promise<T> {
    const url = buildUrl(this.baseUrl, options.path, undefined);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        signal: controller.signal,
        headers: options.headers,
        body: options.form,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new OsvaTransportError("OSVA API request timed out.", {
          cause: error,
        });
      }
      throw new OsvaTransportError("OSVA API transport failed.", {
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new OsvaTransportError("OSVA API returned a non-JSON response.", {
        cause: error,
      });
    }

    if (!response.ok) {
      throw new OsvaApiError(response.status, normalizeErrorBody(body));
    }

    return body as T;
  }

  async download(options: DownloadOptions): Promise<DownloadResult> {
    const url = buildUrl(this.baseUrl, options.path, options.query);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new OsvaTransportError("OSVA API request timed out.", {
          cause: error,
        });
      }
      throw new OsvaTransportError("OSVA API transport failed.", {
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new OsvaApiError(response.status, { status: "error" });
      }
      throw new OsvaApiError(response.status, normalizeErrorBody(body));
    }

    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) {
    throw new Error("baseUrl must not be empty.");
  }
  return trimmed;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query: Readonly<Record<string, string | undefined>> | undefined,
): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, `${baseUrl}/`);
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}

function normalizeErrorBody(body: unknown): {
  status: string;
  [key: string]: unknown;
} {
  if (
    typeof body === "object" &&
    body !== null &&
    "status" in body &&
    typeof (body as { status?: unknown }).status === "string"
  ) {
    return body as { status: string; [key: string]: unknown };
  }
  return { status: "error" };
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}
