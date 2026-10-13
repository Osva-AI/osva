import { context, metrics, propagation, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  NO_OP_INSTRUMENTATION,
  type OsvaInstrumentation,
} from "@osva/observability";

import {
  loadOpenTelemetryConfig,
  type LoadOpenTelemetryConfigOptions,
  type OpenTelemetryConfig,
} from "./config.js";
import { OpenTelemetryInstrumentation } from "./opentelemetry-instrumentation.js";
import { createTraceSampler } from "./sampler.js";

export interface OpenTelemetryLifecycle {
  readonly instrumentation: OsvaInstrumentation;
  readonly config: OpenTelemetryConfig;
  shutdown(): Promise<void>;
}

export function createOpenTelemetryLifecycle(
  env: NodeJS.ProcessEnv = process.env,
  options: LoadOpenTelemetryConfigOptions = {},
): OpenTelemetryLifecycle {
  const config = loadOpenTelemetryConfig(env, options);
  if (!config.enabled || config.otlpEndpoint === undefined) {
    return {
      instrumentation: NO_OP_INSTRUMENTATION,
      config,
      async shutdown() {},
    };
  }

  const headers = config.otlpHeaders;
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
  });
  const sampler = createTraceSampler(
    config.tracesSampler,
    config.tracesSamplerArg,
  );

  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  const tracerProvider = new BasicTracerProvider({
    resource,
    ...(sampler !== undefined ? { sampler } : {}),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: joinOtlpPath(config.otlpEndpoint, "v1/traces"),
          headers,
        }),
        {
          maxQueueSize: 2048,
          maxExportBatchSize: 512,
          scheduledDelayMillis: 5_000,
          exportTimeoutMillis: 30_000,
        },
      ),
    ],
  });
  trace.setGlobalTracerProvider(tracerProvider);

  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: joinOtlpPath(config.otlpEndpoint, "v1/metrics"),
          headers,
        }),
        exportIntervalMillis: 5_000,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  const instrumentation = new OpenTelemetryInstrumentation({
    tracerProvider,
    meterProvider,
  });

  return {
    instrumentation,
    config,
    async shutdown() {
      try {
        await tracerProvider.forceFlush();
        await meterProvider.forceFlush();
      } catch {
        // Flush failures must not block shutdown.
      }
      try {
        await tracerProvider.shutdown();
      } catch {
        // Shutdown failures must not block process exit.
      }
      try {
        await meterProvider.shutdown();
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
