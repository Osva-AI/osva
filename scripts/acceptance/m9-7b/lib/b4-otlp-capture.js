import http from "node:http";

import { waitUntil } from "./timeouts.js";

export const TRACE_SPAN_CHAIN = [
  "osva.http.request",
  "osva.run.create",
  "osva.queue.process",
  "osva.run_attempt.execute",
  "osva.runtime.execute",
];

function collectSpansFromOtlpBodies(bodies) {
  /** @type {{ name: string; traceId: string; spanId: string; parentSpanId: string | null }[]} */
  const spans = [];
  for (const body of bodies) {
    let json;
    try {
      json = JSON.parse(body.toString("utf8"));
    } catch {
      continue;
    }
    for (const resourceSpan of json.resourceSpans ?? []) {
      for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
        for (const span of scopeSpan.spans ?? []) {
          spans.push({
            name: span.name,
            traceId: span.traceId,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId ?? null,
          });
        }
      }
    }
  }
  return spans;
}

/**
 * Require a direct parent chain across the canonical execution span names.
 * @param {Buffer[]} bodies
 */
export function validateTraceParentChain(bodies) {
  const spans = collectSpansFromOtlpBodies(bodies);
  const spanNamesPresent = Object.fromEntries(
    TRACE_SPAN_CHAIN.map((name) => [
      name,
      spans.some((span) => span.name === name),
    ]),
  );

  /** @type {import("./b4-otlp-capture.js").TraceChainMatch | null} */
  let matchedChain = null;

  for (const runtime of spans.filter(
    (span) => span.name === TRACE_SPAN_CHAIN[4],
  )) {
    const attempt = spans.find(
      (span) =>
        span.name === TRACE_SPAN_CHAIN[3] &&
        span.traceId === runtime.traceId &&
        span.spanId === runtime.parentSpanId,
    );
    if (!attempt) {
      continue;
    }
    const queue = spans.find(
      (span) =>
        span.name === TRACE_SPAN_CHAIN[2] &&
        span.traceId === runtime.traceId &&
        span.spanId === attempt.parentSpanId,
    );
    if (!queue) {
      continue;
    }
    const runCreate = spans.find(
      (span) =>
        span.name === TRACE_SPAN_CHAIN[1] &&
        span.traceId === runtime.traceId &&
        span.spanId === queue.parentSpanId,
    );
    if (!runCreate) {
      continue;
    }
    const http = spans.find(
      (span) =>
        span.name === TRACE_SPAN_CHAIN[0] &&
        span.traceId === runtime.traceId &&
        span.spanId === runCreate.parentSpanId,
    );
    if (!http) {
      continue;
    }
    matchedChain = {
      traceId: runtime.traceId,
      links: [
        {
          name: http.name,
          spanId: http.spanId,
          parentSpanId: http.parentSpanId,
        },
        {
          name: runCreate.name,
          spanId: runCreate.spanId,
          parentSpanId: runCreate.parentSpanId,
        },
        {
          name: queue.name,
          spanId: queue.spanId,
          parentSpanId: queue.parentSpanId,
        },
        {
          name: attempt.name,
          spanId: attempt.spanId,
          parentSpanId: attempt.parentSpanId,
        },
        {
          name: runtime.name,
          spanId: runtime.spanId,
          parentSpanId: runtime.parentSpanId,
        },
      ],
    };
    break;
  }

  return {
    spanNamesPresent,
    parentChainValid: matchedChain !== null,
    matchedChain,
    spanCount: spans.length,
  };
}

export async function startOtlpCaptureServer() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        url: request.url ?? "",
        body: Buffer.concat(chunks),
      });
      response.writeHead(200).end();
    });
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind OTLP capture server");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

export async function waitForTraceEvidence(requests, timeoutMs = 90_000) {
  const traceBodies = () =>
    requests
      .filter((item) => item.url.includes("/v1/traces"))
      .map((item) => item.body);

  await waitUntil(
    () => {
      const validation = validateTraceParentChain(traceBodies());
      return (
        validation.parentChainValid &&
        Object.values(validation.spanNamesPresent).every(Boolean)
      );
    },
    {
      timeoutMs,
      intervalMs: 500,
      message: "expected direct parent span chain not exported",
    },
  );

  const bodies = traceBodies();
  const combined = Buffer.concat(bodies).toString("utf8");
  const validation = validateTraceParentChain(bodies);
  return {
    ...validation,
    traceIdPresent: /traceId/.test(combined),
    payloadBytes: combined.length,
    sanitizedSample: combined
      .slice(0, 1500)
      .replace(/osva_ak_[^\s"]+/g, "[REDACTED]"),
  };
}
