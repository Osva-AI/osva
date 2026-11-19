import type { ModelProvider } from "@osva-ai/contracts";
import type {
  MetricAttributes,
  OsvaInstrumentation,
} from "@osva/observability";
import { OSVA_METRIC } from "@osva/observability";

import type { BatchInferenceMetrics } from "./batch-inference-metrics.js";

function providerAttrs(provider: ModelProvider | undefined): MetricAttributes {
  return provider === undefined ? {} : { provider };
}

export function createOtelBatchInferenceMetrics(
  instrumentation: OsvaInstrumentation | undefined,
): BatchInferenceMetrics {
  if (instrumentation === undefined) {
    return {
      recordSubmissionAttempt: () => undefined,
      recordSubmissionSuccess: () => undefined,
      recordSubmissionFailure: () => undefined,
      recordReconciliationAttempt: () => undefined,
      recordReconciliationFailure: () => undefined,
      recordProviderTerminalOutcome: () => undefined,
      recordReconciliationRequired: () => undefined,
      recordCorrelationAnomaly: () => undefined,
      recordCancellation: () => undefined,
      recordItemTerminal: () => undefined,
    };
  }

  const safeCounter = (name: string, attributes?: MetricAttributes): void => {
    try {
      instrumentation.recordCounter(name, 1, attributes);
    } catch {
      // Metrics must not interrupt durable processing.
    }
  };

  return {
    recordSubmissionAttempt: (context) => {
      safeCounter(
        OSVA_METRIC.BATCH_SUBMISSION_ATTEMPTS,
        providerAttrs(context?.provider),
      );
    },
    recordSubmissionSuccess: (context) => {
      safeCounter(
        OSVA_METRIC.BATCH_SUBMISSION_SUCCESS,
        providerAttrs(context?.provider),
      );
    },
    recordSubmissionFailure: (context) => {
      safeCounter(
        OSVA_METRIC.BATCH_SUBMISSION_FAILURE,
        providerAttrs(context?.provider),
      );
    },
    recordReconciliationAttempt: (context) => {
      safeCounter(
        OSVA_METRIC.BATCH_RECONCILIATION_ATTEMPTS,
        providerAttrs(context?.provider),
      );
    },
    recordReconciliationFailure: (context) => {
      safeCounter(
        OSVA_METRIC.BATCH_RECONCILIATION_FAILURES,
        providerAttrs(context?.provider),
      );
    },
    recordProviderTerminalOutcome: (input) => {
      safeCounter(OSVA_METRIC.BATCH_JOB_TERMINAL, {
        ...providerAttrs(input.provider),
        outcome: input.outcome,
      });
    },
    recordReconciliationRequired: (context) => {
      safeCounter(
        OSVA_METRIC.BATCH_RECONCILIATION_REQUIRED,
        providerAttrs(context?.provider),
      );
    },
    recordCorrelationAnomaly: (context) => {
      safeCounter(
        OSVA_METRIC.BATCH_CORRELATION_ANOMALIES,
        providerAttrs(context?.provider),
      );
    },
    recordCancellation: (context) => {
      safeCounter(
        OSVA_METRIC.BATCH_CANCELLATIONS,
        providerAttrs(context?.provider),
      );
    },
    recordItemTerminal: (input) => {
      safeCounter(OSVA_METRIC.BATCH_ITEM_TERMINAL, {
        ...providerAttrs(input.provider),
        status: input.status,
      });
    },
  };
}
