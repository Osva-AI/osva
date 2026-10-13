import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { OSVA_METRIC } from "@osva/observability";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
const COLLECTOR_IMAGE = "otel/opentelemetry-collector-contrib:0.128.0";
const COLLECTOR_CONFIG = path.join(
  REPO_ROOT,
  "deploy",
  "observability",
  "collector",
  "otel-collector.yaml",
);

function dockerAvailable(): boolean {
  const result = spawnSync(
    "docker",
    ["version", "--format", "{{.Server.Version}}"],
    {
      encoding: "utf8",
    },
  );
  return result.status === 0;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate port"));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.text();
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("collector scrape did not become ready");
}

const describeCollector = dockerAvailable() ? describe : describe.skip;

describeCollector("collector prometheus export", () => {
  let containerId: string | undefined;
  let otlpPort = 0;
  let scrapePort = 0;

  beforeAll(async () => {
    otlpPort = await freePort();
    scrapePort = await freePort();
    const started = spawnSync(
      "docker",
      [
        "run",
        "-d",
        "--rm",
        "-p",
        `127.0.0.1:${otlpPort}:4318`,
        "-p",
        `127.0.0.1:${scrapePort}:8889`,
        "-v",
        `${COLLECTOR_CONFIG}:/etc/otelcol-contrib/config.yaml:ro`,
        COLLECTOR_IMAGE,
        "--config=/etc/otelcol-contrib/config.yaml",
      ],
      { encoding: "utf8" },
    );
    if (started.status !== 0) {
      throw new Error(started.stderr || started.stdout || "docker run failed");
    }
    containerId = started.stdout.trim();
    await waitForHttp(`http://127.0.0.1:${scrapePort}/metrics`, 45_000);
  }, 90_000);

  afterAll(async () => {
    if (containerId !== undefined) {
      spawn("docker", ["rm", "-f", containerId], { stdio: "ignore" });
    }
  });

  it("exports OSVA counters under Prometheus names", async () => {
    const meterProvider = new MeterProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: "osva-web",
      }),
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: `http://127.0.0.1:${otlpPort}/v1/metrics`,
          }),
          exportIntervalMillis: 200,
        }),
      ],
    });
    const meter = meterProvider.getMeter("osva");
    meter.createCounter(OSVA_METRIC.HTTP_REQUESTS).add(1, {
      method: "GET",
      route_family: "v1.runs",
      status_class: "2xx",
    });
    meter.createCounter(OSVA_METRIC.SECURITY_EVENTS).add(1, {
      event: "rate_limit.throttled",
    });
    await meterProvider.forceFlush();
    await meterProvider.shutdown();

    const body = await waitForMetric(
      `http://127.0.0.1:${scrapePort}/metrics`,
      "osva_http_requests_total",
      20_000,
    );
    expect(body).toContain("osva_http_requests_total");
    expect(body).toContain("osva_security_events_total");
    expect(body).not.toContain("osva.http.requests");
    expect(body).not.toContain("runId");
    expect(body).not.toContain("workspaceId");
    expect(body).not.toContain("super-secret-token");
  }, 30_000);
});

async function waitForMetric(
  url: string,
  name: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    last = await waitForHttp(url, 5_000);
    if (last.includes(name)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`metric ${name} not found in ${last.slice(0, 500)}`);
}
