import http from "node:http";
import https from "node:https";

export interface DoctorProbeTransport {
  getJson(
    url: string,
    headers?: Readonly<Record<string, string>>,
  ): Promise<HttpProbeResult>;
}

export function createNodeProbeTransport(
  timeoutMs: number,
): DoctorProbeTransport {
  return {
    getJson: (url, headers) => httpGetJson(url, timeoutMs, headers),
  };
}

export function createFetchProbeTransport(
  fetchImpl: typeof fetch,
  timeoutMs: number,
): DoctorProbeTransport {
  return {
    getJson: (url, headers) => fetchGetJson(url, fetchImpl, timeoutMs, headers),
  };
}

export type HttpProbeResult =
  | { kind: "ok"; status: number; body: unknown }
  | { kind: "transport"; cause: unknown }
  | { kind: "timeout" };

export async function httpGetJson(
  urlString: string,
  timeoutMs: number,
  headers: Readonly<Record<string, string>> = {},
): Promise<HttpProbeResult> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch (cause) {
    return { kind: "transport", cause };
  }

  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve) => {
    const request = transport.request(
      url,
      {
        method: "GET",
        headers: {
          connection: "close",
          accept: "application/json",
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body: unknown = null;
          if (text.length > 0) {
            try {
              body = JSON.parse(text) as unknown;
            } catch {
              body = null;
            }
          }
          resolve({
            kind: "ok",
            status: response.statusCode ?? 0,
            body,
          });
        });
        response.on("error", (cause) => {
          resolve({ kind: "transport", cause });
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("timeout"));
    });

    request.on("error", (cause) => {
      if (cause instanceof Error && cause.message === "timeout") {
        resolve({ kind: "timeout" });
        return;
      }
      resolve({ kind: "transport", cause });
    });

    request.end();
  });
}

async function fetchGetJson(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  headers: Readonly<Record<string, string>> = {},
): Promise<HttpProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        connection: "close",
        accept: "application/json",
        ...headers,
      },
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { kind: "ok", status: response.status, body };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      return { kind: "timeout" };
    }
    return { kind: "transport", cause: error };
  } finally {
    clearTimeout(timer);
  }
}
