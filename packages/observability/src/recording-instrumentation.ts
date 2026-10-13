import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import {
  assertSafeMetricAttributes,
  type ActiveSpan,
  type OsvaInstrumentation,
  type SpanAttributes,
  type TraceContextCarrier,
} from "./instrumentation.js";
import type { MetricAttributes } from "./metrics.js";

export interface RecordedMetric {
  readonly name: string;
  readonly kind: "counter" | "histogram" | "gauge";
  readonly value: number;
  readonly attributes?: MetricAttributes;
}

export interface RecordedSpan {
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly attributes: Record<string, string | number | boolean>;
  ok?: boolean;
  ended: boolean;
}

class RecordingSpan implements ActiveSpan {
  readonly recorded: RecordedSpan;

  constructor(recorded: RecordedSpan) {
    this.recorded = recorded;
  }

  setAttributes(attributes: SpanAttributes): void {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) {
        this.recorded.attributes[key] = value;
      }
    }
  }

  setStatus(ok: boolean): void {
    this.recorded.ok = ok;
  }

  recordException(): void {}

  end(): void {
    this.recorded.ended = true;
  }
}

/**
 * In-process instrumentation for tests. Tracks span parent/child relationships
 * through AsyncLocalStorage so queue extract/inject can be asserted without OTLP.
 */
export class RecordingInstrumentation implements OsvaInstrumentation {
  readonly metrics: RecordedMetric[] = [];
  readonly spans: RecordedSpan[] = [];
  private readonly storage = new AsyncLocalStorage<RecordedSpan>();

  startSpan(name: string, attributes?: SpanAttributes): ActiveSpan {
    return new RecordingSpan(this.createSpan(name, attributes));
  }

  async withSpan<T>(
    name: string,
    attributes: SpanAttributes | undefined,
    fn: (span: ActiveSpan) => Promise<T>,
  ): Promise<T> {
    const recorded = this.createSpan(name, attributes);
    const wrapped = new RecordingSpan(recorded);
    try {
      const result = await this.storage.run(recorded, () => fn(wrapped));
      wrapped.setStatus(true);
      return result;
    } catch (error) {
      wrapped.setStatus(false);
      throw error;
    } finally {
      wrapped.end();
    }
  }

  recordCounter(name: string, value = 1, attributes?: MetricAttributes): void {
    assertSafeMetricAttributes(attributes);
    this.metrics.push({ name, kind: "counter", value, attributes });
  }

  recordHistogram(
    name: string,
    value: number,
    attributes?: MetricAttributes,
  ): void {
    assertSafeMetricAttributes(attributes);
    this.metrics.push({ name, kind: "histogram", value, attributes });
  }

  recordGauge(
    name: string,
    value: number,
    attributes?: MetricAttributes,
  ): void {
    assertSafeMetricAttributes(attributes);
    this.metrics.push({ name, kind: "gauge", value, attributes });
  }

  injectTraceContext(): TraceContextCarrier | undefined {
    const current = this.storage.getStore();
    if (current === undefined) {
      return undefined;
    }

    return {
      traceparent: `00-${current.traceId}-${current.spanId}-01`,
    };
  }

  async runWithExtractedContext<T>(
    carrier: TraceContextCarrier | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    const parsed = parseTraceparent(carrier?.traceparent);
    if (parsed === undefined) {
      return fn();
    }

    const extracted: RecordedSpan = {
      name: "__extracted__",
      traceId: parsed.traceId,
      spanId: parsed.spanId,
      parentSpanId: undefined,
      attributes: {},
      ended: true,
    };
    return this.storage.run(extracted, fn);
  }

  countersNamed(name: string): readonly RecordedMetric[] {
    return this.metrics.filter(
      (metric) => metric.kind === "counter" && metric.name === name,
    );
  }

  histogramsNamed(name: string): readonly RecordedMetric[] {
    return this.metrics.filter(
      (metric) => metric.kind === "histogram" && metric.name === name,
    );
  }

  gaugesNamed(name: string): readonly RecordedMetric[] {
    return this.metrics.filter(
      (metric) => metric.kind === "gauge" && metric.name === name,
    );
  }

  private createSpan(name: string, attributes?: SpanAttributes): RecordedSpan {
    const parent = this.storage.getStore();
    const recorded: RecordedSpan = {
      name,
      traceId: parent?.traceId ?? randomHex(16),
      spanId: randomHex(8),
      parentSpanId: parent?.spanId,
      attributes: {},
      ended: false,
    };
    if (attributes !== undefined) {
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== undefined) {
          recorded.attributes[key] = value;
        }
      }
    }
    this.spans.push(recorded);
    return recorded;
  }
}

function parseTraceparent(
  traceparent: string | undefined,
): { readonly traceId: string; readonly spanId: string } | undefined {
  if (traceparent === undefined) {
    return undefined;
  }

  const parts = traceparent.split("-");
  if (parts.length < 4) {
    return undefined;
  }

  const traceId = parts[1];
  const spanId = parts[2];
  if (
    traceId === undefined ||
    spanId === undefined ||
    traceId.length === 0 ||
    spanId.length === 0
  ) {
    return undefined;
  }

  return { traceId, spanId };
}

function randomHex(bytes: number): string {
  return randomUUID()
    .replaceAll("-", "")
    .slice(0, bytes * 2);
}
