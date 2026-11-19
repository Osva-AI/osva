import { describe, expect, it } from "vitest";

import { RecordingInstrumentation } from "@osva/observability";
import { OSVA_METRIC } from "@osva/observability";

import { createOtelBatchInferenceMetrics } from "../src/otel-batch-inference-metrics.js";

describe("createOtelBatchInferenceMetrics", () => {
  it("records bounded provider and outcome labels", () => {
    const instrumentation = new RecordingInstrumentation();
    const metrics = createOtelBatchInferenceMetrics(instrumentation);
    metrics.recordSubmissionAttempt({ provider: "OPENAI" });
    metrics.recordSubmissionSuccess({ provider: "OPENAI" });
    metrics.recordProviderTerminalOutcome({
      provider: "OPENAI",
      outcome: "PARTIAL",
    });
    metrics.recordItemTerminal({ provider: "OPENAI", status: "FAILED" });
    metrics.recordCorrelationAnomaly({ provider: "OPENAI" });

    const names = instrumentation.metrics.map((metric) => metric.name);
    expect(names).toContain(OSVA_METRIC.BATCH_SUBMISSION_ATTEMPTS);
    expect(names).toContain(OSVA_METRIC.BATCH_SUBMISSION_SUCCESS);
    expect(names).toContain(OSVA_METRIC.BATCH_JOB_TERMINAL);
    expect(names).toContain(OSVA_METRIC.BATCH_ITEM_TERMINAL);
    expect(names).toContain(OSVA_METRIC.BATCH_CORRELATION_ANOMALIES);
    for (const metric of instrumentation.metrics) {
      expect(metric.attributes?.workspaceId).toBeUndefined();
      expect(metric.attributes?.jobId).toBeUndefined();
    }
  });
});
