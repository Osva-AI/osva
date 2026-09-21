import type { TestApiKeyRecord } from "../src/test-security.js";
import { authorizationHeader } from "../src/test-security.js";

let defaultAuthHeaders: Record<string, string> = {};

export function setTestAuthHeaders(testApiKey: TestApiKeyRecord): void {
  defaultAuthHeaders = authorizationHeader(testApiKey.plaintextToken);
}

export function authHeadersForKey(
  testApiKey: TestApiKeyRecord,
): Record<string, string> {
  return authorizationHeader(testApiKey.plaintextToken);
}

export async function fetchJson(
  url: string,
  options?: {
    readonly method?: string;
    readonly body?: unknown;
    readonly headers?: Record<string, string>;
  },
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: options?.method ?? "GET",
    headers: {
      ...defaultAuthHeaders,
      ...options?.headers,
      ...(options?.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    body:
      options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, body: await response.json() };
}

export function createAuthenticatedFetchJson(
  testApiKey: TestApiKeyRecord,
): typeof fetchJson {
  const headers = authorizationHeader(testApiKey.plaintextToken);
  return async (url, options) => {
    const response = await fetch(url, {
      method: options?.method ?? "GET",
      headers: {
        ...headers,
        ...options?.headers,
        ...(options?.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      body:
        options?.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return { status: response.status, body: await response.json() };
  };
}
