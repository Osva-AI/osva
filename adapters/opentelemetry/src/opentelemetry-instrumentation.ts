import {
  context,
  propagation,
  trace,
  metrics,
  SpanStatusCode,
} from "@opentelemetry/api";
import type { Counter, Histogram, Meter } from "@opentelemetry/api";
import type { Span } from "@opentelemetry/api";
import {
  assertSafeMetricAttributes,
  type ActiveSpan,
  type MetricAttributes,
  type OsvaInstrumentation,
  type SpanAttributes,
  type TraceContextCarrier,
} from "@osva/observability";

class OpenTelemetrySpan implements ActiveSpan {
  constructor(private readonly span: Span) {}

  setAttributes(attributes: SpanAttributes): void {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) {
        this.span.setAttribute(key, value);
      }
    }
  }

  setStatus(ok: boolean, errorCategory?: string): void {
    if (ok) {
      this.span.setStatus({ code: SpanStatusCode.OK });
      return;
    }

    this.span.setStatus({
      code: SpanStatusCode.ERROR,
      message: errorCategory,
    });
    if (errorCategory !== undefined) {
      this.span.setAttribute("osva.error_category", errorCategory);
    }
  }

  recordException(error: unknown): void {
    if (error instanceof Error) {
      this.span.recordException(error);
    }
  }

  end(): void {
    this.span.end();
  }
}

export interface OpenTelemetryInstrumentationOptions {
  readonly tracerName?: string;
  readonly meterName?: string;
}

export class OpenTelemetryInstrumentation implements OsvaInstrumentation {
  private readonly tracer;
  private readonly meter: Meter;
  private readonly counters = new Map<string, Counter>();
  private readonly histograms = new Map<string, Histogram>();

  constructor(options: OpenTelemetryInstrumentationOptions = {}) {
    this.tracer = trace.getTracer(options.tracerName ?? "osva");
    this.meter = metrics.getMeter(options.meterName ?? "osva");
  }

  startSpan(name: string, attributes?: SpanAttributes): ActiveSpan {
    const span = this.tracer.startSpan(name);
    const wrapped = new OpenTelemetrySpan(span);
    if (attributes !== undefined) {
      wrapped.setAttributes(attributes);
    }
    return wrapped;
  }

  async withSpan<T>(
    name: string,
    attributes: SpanAttributes | undefined,
    fn: (span: ActiveSpan) => Promise<T>,
  ): Promise<T> {
    return this.tracer.startActiveSpan(name, async (span) => {
      const wrapped = new OpenTelemetrySpan(span);
      if (attributes !== undefined) {
        wrapped.setAttributes(attributes);
      }

      try {
        const result = await fn(wrapped);
        wrapped.setStatus(true);
        return result;
      } catch (error) {
        wrapped.setStatus(false, error instanceof Error ? error.name : "ERROR");
        wrapped.recordException(error);
        throw error;
      }
    });
  }

  recordCounter(name: string, value = 1, attributes?: MetricAttributes): void {
    this.recordMetric("counter", name, value, attributes);
  }

  recordHistogram(
    name: string,
    value: number,
    attributes?: MetricAttributes,
  ): void {
    this.recordMetric("histogram", name, value, attributes);
  }

  injectTraceContext(): TraceContextCarrier | undefined {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    if (carrier.traceparent === undefined) {
      return undefined;
    }

    return {
      traceparent: carrier.traceparent,
      tracestate: carrier.tracestate,
    };
  }

  async runWithExtractedContext<T>(
    carrier: TraceContextCarrier | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (carrier?.traceparent === undefined) {
      return fn();
    }

    const extractedCarrier: Record<string, string> = {
      traceparent: carrier.traceparent,
    };
    if (carrier.tracestate !== undefined) {
      extractedCarrier.tracestate = carrier.tracestate;
    }

    const extractedContext = propagation.extract(
      context.active(),
      extractedCarrier,
    );
    return context.with(extractedContext, fn);
  }

  private recordMetric(
    kind: "counter" | "histogram",
    name: string,
    value: number,
    attributes?: MetricAttributes,
  ): void {
    try {
      assertSafeMetricAttributes(attributes);
      if (kind === "counter") {
        const counter =
          this.counters.get(name) ??
          this.meter.createCounter(name, { description: name });
        this.counters.set(name, counter);
        counter.add(value, attributes);
        return;
      }

      const histogram =
        this.histograms.get(name) ??
        this.meter.createHistogram(name, { description: name });
      this.histograms.set(name, histogram);
      histogram.record(value, attributes);
    } catch {
      // Telemetry must never fail product execution.
    }
  }
}
