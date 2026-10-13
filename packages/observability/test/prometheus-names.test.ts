import { describe, expect, it } from "vitest";

import { OSVA_METRIC } from "../src/metrics.js";
import {
  OSVA_METRIC_KIND,
  prometheusHistogramBucket,
  prometheusMetricName,
  prometheusNameForOsvaMetric,
} from "../src/prometheus-names.js";

describe("prometheus metric names", () => {
  it("maps counters to _total and leaves gauges/histograms unsuffixed", () => {
    expect(prometheusMetricName(OSVA_METRIC.HTTP_REQUESTS, "counter")).toBe(
      "osva_http_requests_total",
    );
    expect(prometheusMetricName(OSVA_METRIC.QUEUE_JOBS, "gauge")).toBe(
      "osva_queue_jobs",
    );
    expect(
      prometheusMetricName(OSVA_METRIC.HTTP_REQUEST_DURATION_MS, "histogram"),
    ).toBe("osva_http_request_duration_ms");
    expect(
      prometheusHistogramBucket(OSVA_METRIC.HTTP_REQUEST_DURATION_MS),
    ).toBe("osva_http_request_duration_ms_bucket");
  });

  it("covers the M9.5 catalog without identity labels", () => {
    expect(
      prometheusNameForOsvaMetric(OSVA_METRIC.RECOVERY_TRANSPORT_REPAIRED),
    ).toBe("osva_recovery_transport_repaired_total");
    expect(prometheusNameForOsvaMetric(OSVA_METRIC.SECURITY_EVENTS)).toBe(
      "osva_security_events_total",
    );
    expect(OSVA_METRIC_KIND[OSVA_METRIC.QUEUE_JOBS]).toBe("gauge");
    expect(Object.keys(OSVA_METRIC_KIND)).toEqual(Object.values(OSVA_METRIC));
  });
});
