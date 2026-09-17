import { FORBIDDEN_METRIC_LABELS } from "./attributes.js";
import type { MetricAttributes, MetricKind } from "./metrics.js";

export type SpanAttributeValue = string | number | boolean;

export type SpanAttributes = Readonly<
  Record<string, SpanAttributeValue | undefined>
>;

export interface ActiveSpan {
  setAttributes(attributes: SpanAttributes): void;
  setStatus(ok: boolean, errorCategory?: string): void;
  recordException(error: unknown): void;
  end(): void;
}

export interface TraceContextCarrier {
  readonly traceparent?: string;
  readonly tracestate?: string;
}

/**
 * Vendor-neutral OSVA instrumentation seam. Implementations may export to
 * OpenTelemetry; callers must treat telemetry as auxiliary diagnostics.
 */
export interface OsvaInstrumentation {
  startSpan(name: string, attributes?: SpanAttributes): ActiveSpan;
  withSpan<T>(
    name: string,
    attributes: SpanAttributes | undefined,
    fn: (span: ActiveSpan) => Promise<T>,
  ): Promise<T>;
  recordCounter(
    name: string,
    value?: number,
    attributes?: MetricAttributes,
  ): void;
  recordHistogram(
    name: string,
    value: number,
    attributes?: MetricAttributes,
  ): void;
  injectTraceContext(): TraceContextCarrier | undefined;
  runWithExtractedContext<T>(
    carrier: TraceContextCarrier | undefined,
    fn: () => Promise<T>,
  ): Promise<T>;
  flush?(): Promise<void>;
  shutdown?(): Promise<void>;
}

class NoOpSpan implements ActiveSpan {
  setAttributes(): void {}
  setStatus(): void {}
  recordException(): void {}
  end(): void {}
}

export const NO_OP_INSTRUMENTATION: OsvaInstrumentation = Object.freeze({
  startSpan(): ActiveSpan {
    return new NoOpSpan();
  },
  async withSpan<T>(
    _name: string,
    _attributes: SpanAttributes | undefined,
    fn: (span: ActiveSpan) => Promise<T>,
  ): Promise<T> {
    return fn(new NoOpSpan());
  },
  recordCounter(): void {},
  recordHistogram(): void {},
  injectTraceContext(): TraceContextCarrier | undefined {
    return undefined;
  },
  async runWithExtractedContext<T>(
    _carrier: TraceContextCarrier | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    return fn();
  },
});

export function resolveInstrumentation(
  instrumentation: OsvaInstrumentation | undefined,
): OsvaInstrumentation {
  return instrumentation ?? NO_OP_INSTRUMENTATION;
}

export function assertSafeMetricAttributes(
  attributes: MetricAttributes | undefined,
): void {
  if (attributes === undefined) {
    return;
  }

  for (const key of Object.keys(attributes)) {
    if (FORBIDDEN_METRIC_LABELS.has(key)) {
      throw new Error(
        `Metric attribute '${key}' is high-cardinality and must not be used as a label.`,
      );
    }
  }
}

export function elapsedMs(startedAt: number, endedAt: number): number {
  return Math.max(0, endedAt - startedAt);
}

export function normalizeErrorCategory(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    return error.code;
  }

  return "UNKNOWN";
}

export type { MetricKind };
