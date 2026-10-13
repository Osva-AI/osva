import type { ServerResponse } from "node:http";

import {
  elapsedMs,
  OSVA_ATTR,
  OSVA_METRIC,
  OSVA_SPAN,
  resolveInstrumentation,
  type OsvaInstrumentation,
} from "@osva/observability";

import {
  classifyHttpMethod,
  classifyHttpRouteFamily,
  classifyHttpStatusClass,
  isProbeRouteFamily,
} from "./http-route-family.js";

export interface HttpRequestLog {
  (event: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface HttpRequestTelemetryInput {
  readonly method: string;
  readonly pathname: string;
  readonly requestId: string;
  readonly response: ServerResponse;
  readonly instrumentation?: OsvaInstrumentation;
  readonly logEvent?: HttpRequestLog;
}

export async function withHttpRequestTelemetry(
  input: HttpRequestTelemetryInput,
  fn: () => Promise<void>,
): Promise<void> {
  const method = classifyHttpMethod(input.method);
  const routeFamily = classifyHttpRouteFamily(input.pathname);
  if (isProbeRouteFamily(routeFamily)) {
    await fn();
    return;
  }

  const telemetry = resolveInstrumentation(input.instrumentation);
  const startedAt = performance.now();
  let recorded = false;

  const recordCompletion = (statusCode: number): void => {
    if (recorded) {
      return;
    }
    recorded = true;
    const statusClass = classifyHttpStatusClass(statusCode);
    const durationMs = elapsedMs(startedAt, performance.now());
    const attributes = {
      method,
      route_family: routeFamily,
      status_class: statusClass,
    };
    try {
      telemetry.recordCounter(OSVA_METRIC.HTTP_REQUESTS, 1, attributes);
      telemetry.recordHistogram(
        OSVA_METRIC.HTTP_REQUEST_DURATION_MS,
        durationMs,
        attributes,
      );
    } catch {
      // HTTP metrics must never fail the request.
    }
    input.logEvent?.("http.request.completed", {
      requestId: input.requestId,
      method,
      routeFamily,
      status: statusCode,
      statusClass,
      durationMs,
    });
  };

  try {
    await telemetry.withSpan(
      OSVA_SPAN.HTTP_REQUEST,
      {
        [OSVA_ATTR.REQUEST_ID]: input.requestId,
        [OSVA_ATTR.HTTP_METHOD]: method,
        [OSVA_ATTR.HTTP_ROUTE_FAMILY]: routeFamily,
      },
      async (span) => {
        await fn();
        const statusCode = input.response.statusCode;
        span.setAttributes({
          [OSVA_ATTR.HTTP_STATUS_CLASS]: classifyHttpStatusClass(statusCode),
        });
        span.setStatus(statusCode < 500);
      },
    );
    recordCompletion(input.response.statusCode);
  } catch (error) {
    const statusCode = input.response.headersSent
      ? input.response.statusCode
      : 500;
    recordCompletion(statusCode);
    throw error;
  }
}
