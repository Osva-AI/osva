import http from "node:http";
import type { AddressInfo } from "node:net";

import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { OSVA_ATTR, OSVA_METRIC, OSVA_SPAN } from "@osva/observability";
import { afterEach, describe, expect, it } from "vitest";

import { createOpenTelemetryLifecycle } from "../src/node-sdk.js";

interface CapturedRequest {
  readonly url: string;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: Buffer;
}

async function startCaptureServer(): Promise<{
  url: string;
  requests: CapturedRequest[];
  close(): Promise<void>;
}> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      requests.push({
        url: request.url ?? "",
        headers: request.headers,
        body: Buffer.concat(chunks),
      });
      response.writeHead(200).end();
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function waitForRequests(
  requests: CapturedRequest[],
  predicate: (items: CapturedRequest[]) => boolean,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate(requests)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `OTLP requests not received: ${JSON.stringify(requests.map((item) => item.url))}`,
  );
}

describe("OTLP HTTP exporter", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (closers.length > 0) {
      await closers.pop()?.();
    }
  });

  it("posts traces and metrics to OTLP HTTP paths and omits secrets from bodies", async () => {
    const server = await startCaptureServer();
    closers.push(() => server.close());

    const headers = { Authorization: "Bearer super-secret-token" };
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "osva-web",
    });
    const tracerProvider = new BasicTracerProvider({
      resource,
      spanProcessors: [
        new SimpleSpanProcessor(
          new OTLPTraceExporter({
            url: `${server.url}/v1/traces`,
            headers,
          }),
        ),
      ],
    });
    const meterProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: `${server.url}/v1/metrics`,
            headers,
          }),
          exportIntervalMillis: 200,
        }),
      ],
    });
    closers.push(async () => {
      await tracerProvider.shutdown();
      await meterProvider.shutdown();
    });

    const tracer = tracerProvider.getTracer("osva");
    const span = tracer.startSpan(OSVA_SPAN.HTTP_REQUEST);
    span.setAttribute(OSVA_ATTR.HTTP_METHOD, "GET");
    span.setAttribute(OSVA_ATTR.HTTP_ROUTE_FAMILY, "v1.runs");
    span.end();
    meterProvider
      .getMeter("osva")
      .createCounter(OSVA_METRIC.HTTP_REQUESTS)
      .add(1, {
        method: "GET",
        route_family: "v1.runs",
        status_class: "2xx",
      });
    await tracerProvider.forceFlush();
    await meterProvider.forceFlush();

    await waitForRequests(
      server.requests,
      (items) =>
        items.some((item) => item.url.endsWith("/v1/traces")) &&
        items.some((item) => item.url.endsWith("/v1/metrics")),
    );

    const combined = Buffer.concat(
      server.requests.map((item) => item.body),
    ).toString("utf8");
    expect(combined).toContain(OSVA_SPAN.HTTP_REQUEST);
    expect(combined).not.toContain("super-secret-token");
    expect(combined).not.toContain("osva_ak_");
    expect(combined).not.toContain("OPENAI_API_KEY");
    expect(combined.toLowerCase()).not.toContain("prompt");
    expect(server.requests.some((item) => item.headers.authorization)).toBe(
      true,
    );
  }, 15_000);

  it("createOpenTelemetryLifecycle posts traces to /v1/traces", async () => {
    const server = await startCaptureServer();
    closers.push(() => server.close());
    const lifecycle = createOpenTelemetryLifecycle(
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: server.url,
        OTEL_SERVICE_NAME: "osva-web",
        OTEL_TRACES_SAMPLER: "always_on",
      },
      { defaultServiceName: "osva-web" },
    );
    closers.push(() => lifecycle.shutdown());

    expect(lifecycle.config.enabled).toBe(true);
    expect(lifecycle.config.otlpEndpoint).toBe(server.url);
    const span = lifecycle.instrumentation.startSpan(OSVA_SPAN.HTTP_REQUEST, {
      [OSVA_ATTR.HTTP_METHOD]: "POST",
    });
    span.end();
    await lifecycle.instrumentation.withSpan(
      OSVA_SPAN.QUEUE_PROCESS,
      {},
      async () => "ok",
    );
    await lifecycle.shutdown();

    await waitForRequests(server.requests, (items) =>
      items.some((item) => item.url.endsWith("/v1/traces")),
    );
    const combined = Buffer.concat(
      server.requests.map((item) => item.body),
    ).toString("utf8");
    expect(combined).toContain(OSVA_SPAN.HTTP_REQUEST);
  }, 15_000);

  it("flushes batched nested spans with parent links on shutdown", async () => {
    const server = await startCaptureServer();
    closers.push(() => server.close());
    const lifecycle = createOpenTelemetryLifecycle(
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: server.url,
        OTEL_SERVICE_NAME: "osva-web",
        OTEL_TRACES_SAMPLER: "always_on",
      },
      { defaultServiceName: "osva-web" },
    );
    closers.push(() => lifecycle.shutdown());

    await lifecycle.instrumentation.withSpan(
      OSVA_SPAN.HTTP_REQUEST,
      {},
      async () =>
        lifecycle.instrumentation.withSpan(
          OSVA_SPAN.RUN_CREATE,
          {},
          async () => "ok",
        ),
    );
    await lifecycle.shutdown();

    await waitForRequests(server.requests, (items) =>
      items.some((item) => item.url.endsWith("/v1/traces")),
    );
    const combined = Buffer.concat(
      server.requests.map((item) => item.body),
    ).toString("utf8");
    expect(combined).toContain(OSVA_SPAN.RUN_CREATE);
    expect(combined).toMatch(/parentSpanId/);
  }, 15_000);

  it("keeps execution no-op-safe when the collector is unreachable", async () => {
    const lifecycle = createOpenTelemetryLifecycle(
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1",
      },
      { defaultServiceName: "osva-worker" },
    );
    closers.push(() => lifecycle.shutdown());
    await expect(
      lifecycle.instrumentation.withSpan(
        OSVA_SPAN.QUEUE_PROCESS,
        { [OSVA_ATTR.RUNTIME_KIND]: "typescript" },
        async () => "ok",
      ),
    ).resolves.toBe("ok");
    await expect(lifecycle.shutdown()).resolves.toBeUndefined();
  }, 35_000);

  it("stays disabled without an endpoint", async () => {
    const lifecycle = createOpenTelemetryLifecycle(
      {},
      { defaultServiceName: "osva-mcp" },
    );
    closers.push(() => lifecycle.shutdown());
    expect(lifecycle.config.enabled).toBe(false);
    await expect(
      lifecycle.instrumentation.withSpan(
        OSVA_SPAN.HTTP_REQUEST,
        {},
        async () => 1,
      ),
    ).resolves.toBe(1);
  });
});
