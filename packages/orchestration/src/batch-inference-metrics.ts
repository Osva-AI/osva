import type {
  BatchInferenceItemStatus,
  ModelProvider,
} from "@osva-ai/contracts";

export interface BatchInferenceMetricContext {
  readonly provider?: ModelProvider;
}

export interface BatchInferenceMetrics {
  readonly recordSubmissionAttempt: (
    context?: BatchInferenceMetricContext,
  ) => void;
  readonly recordSubmissionSuccess: (
    context?: BatchInferenceMetricContext,
  ) => void;
  readonly recordSubmissionFailure: (
    context?: BatchInferenceMetricContext,
  ) => void;
  readonly recordReconciliationAttempt: (
    context?: BatchInferenceMetricContext,
  ) => void;
  readonly recordReconciliationFailure: (
    context?: BatchInferenceMetricContext,
  ) => void;
  readonly recordProviderTerminalOutcome: (input: {
    readonly provider?: ModelProvider;
    readonly outcome:
      "COMPLETED" | "FAILED" | "CANCELLED" | "EXPIRED" | "PARTIAL";
  }) => void;
  readonly recordReconciliationRequired: (
    context?: BatchInferenceMetricContext,
  ) => void;
  readonly recordCorrelationAnomaly: (
    context?: BatchInferenceMetricContext,
  ) => void;
  readonly recordCancellation: (context?: BatchInferenceMetricContext) => void;
  readonly recordItemTerminal: (input: {
    readonly provider?: ModelProvider;
    readonly status: Extract<
      BatchInferenceItemStatus,
      "SUCCEEDED" | "FAILED" | "CANCELLED" | "EXPIRED"
    >;
  }) => void;
}

export const noopBatchInferenceMetrics: BatchInferenceMetrics = {
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
