import { redactString } from "./redact.js";

export async function fetchJson(url, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (options.body !== undefined && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body:
      options.body === undefined
        ? undefined
        : typeof options.body === "string"
          ? options.body
          : JSON.stringify(options.body),
  });
  let body;
  const text = await response.text();
  try {
    body = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return {
    status: response.status,
    body,
    headers: Object.fromEntries(response.headers.entries()),
  };
}

export function sanitizeHttpEvidence(result, extra = {}) {
  const serialized = JSON.stringify(result.body ?? {});
  return {
    status: result.status,
    code: result.body?.code,
    requestId: result.headers["x-osva-request-id"],
    bodySample: redactString(serialized.slice(0, 500)),
    ...extra,
  };
}

export function bearer(token) {
  return { authorization: `Bearer ${token}` };
}
