import { context, metrics, propagation, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { OsvaInstrumentation } from "@osva/observability";

import { OpenTelemetryInstrumentation } from "../opentelemetry-instrumentation.js";

export interface InMemoryOpenTelemetryHarness {
  readonly instrumentation: OsvaInstrumentation;
  readonly spanExporter: InMemorySpanExporter;
  readonly metricExporter: InMemoryMetricExporter;
  shutdown(): Promise<void>;
}

export async function createInMemoryOpenTelemetryHarness(): Promise<InMemoryOpenTelemetryHarness> {
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "osva-test",
  });
  const spanExporter = new InMemorySpanExporter();
  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });
  trace.setGlobalTracerProvider(tracerProvider);

  const metricExporter = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 100,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);

  return {
    instrumentation: new OpenTelemetryInstrumentation(),
    spanExporter,
    metricExporter,
    async shutdown() {
      await tracerProvider.shutdown();
      await meterProvider.shutdown();
    },
  };
}

export { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
export { InMemoryMetricExporter } from "@opentelemetry/sdk-metrics";
