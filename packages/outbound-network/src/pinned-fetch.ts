import http from "node:http";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";

import type { ResolvedAddress } from "./outbound-network.js";

export interface PinnedRemoteHttpConnection {
  readonly url: URL;
  /** TLS SNI and certificate hostname. Never replaced with the pinned IP. */
  readonly hostname: string;
  readonly address: ResolvedAddress;
}

export interface PinnedFetchInit {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal?: AbortSignal;
}

/**
 * Performs one HTTP(S) request against a pre-validated address. The socket
 * connects to `address` directly; no hostname DNS lookup occurs at request time.
 */
export async function fetchWithPinnedConnection(
  connection: PinnedRemoteHttpConnection,
  init: PinnedFetchInit,
): Promise<Response> {
  if (init.signal?.aborted) {
    throw abortError();
  }

  const { url, hostname, address } = connection;
  const isHttps = url.protocol === "https:";
  const port = url.port.length > 0 ? Number(url.port) : isHttps ? 443 : 80;
  const path = `${url.pathname}${url.search}`;

  return await new Promise<Response>((resolve, reject) => {
    let settled = false;

    const finish = (handler: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      handler();
    };

    const requestOptions: https.RequestOptions = {
      host: address.address,
      port,
      path,
      method: init.method,
      headers: {
        ...init.headers,
        host: url.host,
        "content-length": String(Buffer.byteLength(init.body, "utf8")),
      },
      ...(isHttps
        ? {
            servername: hostname,
            rejectUnauthorized: true,
          }
        : {}),
    };

    const req = (isHttps ? https : http).request(requestOptions, (res) => {
      const chunks: Buffer[] = [];
      let received = 0;

      res.on("data", (chunk: Buffer) => {
        received += chunk.length;
        chunks.push(chunk);
      });

      res.on("end", () => {
        finish(() => {
          resolve(
            new Response(Buffer.concat(chunks, received), {
              status: res.statusCode ?? 502,
              headers: toHeaders(res.headers),
            }),
          );
        });
      });

      res.on("error", (error) => {
        finish(() => {
          reject(error);
        });
      });
    });

    req.on("error", (error) => {
      finish(() => {
        reject(error);
      });
    });

    init.signal?.addEventListener(
      "abort",
      () => {
        req.destroy(abortError());
      },
      { once: true },
    );

    req.write(init.body);
    req.end();
  });
}

function toHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        result.append(key, item);
      }
      continue;
    }

    result.set(key, value);
  }

  return result;
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}
