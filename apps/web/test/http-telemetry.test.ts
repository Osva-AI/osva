import { describe, expect, it } from "vitest";
import type { ServerResponse } from "node:http";

import {
  OSVA_METRIC,
  OSVA_SPAN,
  RecordingInstrumentation,
} from "@osva/observability";

import { withHttpRequestTelemetry } from "../src/http-telemetry.js";

function fakeResponse(statusCode = 200): ServerResponse {
  return { statusCode, headersSent: true } as ServerResponse;
}

describe("HTTP request telemetry", () => {
  it("records exactly one completion for success", async () => {
    const telemetry = new RecordingInstrumentation();
    const logs: Array<Record<string, unknown>> = [];

    await withHttpRequestTelemetry(
      {
        method: "GET",
        pathname: "/v1/runs",
        requestId: "req-success",
        response: fakeResponse(200),
        instrumentation: telemetry,
        logEvent: (event, fields) => {
          logs.push({ event, ...fields });
        },
      },
      async () => undefined,
    );

    expect(telemetry.countersNamed(OSVA_METRIC.HTTP_REQUESTS)).toHaveLength(1);
    expect(
      telemetry.histogramsNamed(OSVA_METRIC.HTTP_REQUEST_DURATION_MS)[0]?.value,
    ).toBeGreaterThanOrEqual(0);
    expect(
      telemetry.spans.some((span) => span.name === OSVA_SPAN.HTTP_REQUEST),
    ).toBe(true);
    expect(logs).toEqual([
      expect.objectContaining({
        event: "http.request.completed",
        requestId: "req-success",
        method: "GET",
        routeFamily: "v1.runs",
        status: 200,
        statusClass: "2xx",
      }),
    ]);
    expect(JSON.stringify(logs)).not.toContain("Authorization");
    expect(JSON.stringify(logs)).not.toContain("osva_ak_");
  });

  it("records exactly one completion when the handler throws", async () => {
    const telemetry = new RecordingInstrumentation();
    const response = fakeResponse(200);
    (response as { headersSent: boolean }).headersSent = false;
    response.statusCode = 200;

    await expect(
      withHttpRequestTelemetry(
        {
          method: "POST",
          pathname: "/v1/runs",
          requestId: "req-boom",
          response,
          instrumentation: telemetry,
        },
        async () => {
          throw new Error("handler exploded");
        },
      ),
    ).rejects.toThrow("handler exploded");

    expect(telemetry.countersNamed(OSVA_METRIC.HTTP_REQUESTS)).toHaveLength(1);
    expect(
      telemetry.countersNamed(OSVA_METRIC.HTTP_REQUESTS)[0]?.attributes,
    ).toEqual({
      method: "POST",
      route_family: "v1.runs",
      status_class: "5xx",
    });
  });

  it("excludes health and ready probes from HTTP SLIs", async () => {
    const telemetry = new RecordingInstrumentation();
    await withHttpRequestTelemetry(
      {
        method: "GET",
        pathname: "/health",
        requestId: "req-health",
        response: fakeResponse(200),
        instrumentation: telemetry,
      },
      async () => undefined,
    );

    expect(telemetry.metrics).toHaveLength(0);
    expect(telemetry.spans).toHaveLength(0);
  });
});
