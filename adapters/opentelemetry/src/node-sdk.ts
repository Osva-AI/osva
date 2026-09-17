import { context, propagation } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  NO_OP_INSTRUMENTATION,
  type OsvaInstrumentation,
} from "@osva/observability";

import { loadOpenTelemetryConfig, type OpenTelemetryConfig } from "./config.js";
import { OpenTelemetryInstrumentation } from "./opentelemetry-instrumentation.js";

export interface OpenTelemetryLifecycle {
  readonly instrumentation: OsvaInstrumentation;
  readonly config: OpenTelemetryConfig;
  shutdown(): Promise<void>;
}

export function createOpenTelemetryLifecycle(
  env: NodeJS.ProcessEnv = process.env,
): OpenTelemetryLifecycle {
  const config = loadOpenTelemetryConfig(env);
  if (!config.enabled || config.otlpEndpoint === undefined) {
    return {
      instrumentation: NO_OP_INSTRUMENTATION,
      config,
      async shutdown() {},
    };
  }

  const headers = config.otlpHeaders;
  const traceExporter = new OTLPTraceExporter({
    url: joinOtlpPath(config.otlpEndpoint, "v1/traces"),
    headers,
  });
  const metricExporter = new OTLPMetricExporter({
    url: joinOtlpPath(config.otlpEndpoint, "v1/metrics"),
    headers,
  });

  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
    }),
    traceExporter,
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 5_000,
    }),
    contextManager,
  });

  let started = false;
  try {
    sdk.start();
    started = true;
  } catch {
    return {
      instrumentation: NO_OP_INSTRUMENTATION,
      config,
      async shutdown() {},
    };
  }

  const instrumentation = new OpenTelemetryInstrumentation();

  return {
    instrumentation,
    config,
    async shutdown() {
      if (!started) {
        return;
      }

      try {
        await sdk.shutdown();
      } catch {
        // Shutdown failures must not block process exit.
      }
    },
  };
}

function joinOtlpPath(endpoint: string, path: string): string {
  const trimmed = endpoint.replace(/\/+$/, "");
  if (trimmed.endsWith(path)) {
    return trimmed;
  }

  return `${trimmed}/${path}`;
}
