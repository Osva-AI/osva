import type {
  BatchInferenceItemRequest,
  BatchInferenceProviderBatchId,
  BatchInferenceProviderJobStatus,
  GenerateCompletionResult,
  ModelProvider,
  ModelUsage,
  BatchInferenceItemError,
} from "@osva-ai/contracts";
import type { BatchInferenceProviderCorrelationId } from "@osva-ai/contracts";

export interface BatchInferenceProviderSubmitRequest {
  readonly provider: ModelProvider;
  readonly providerModelId: string;
  readonly items: readonly BatchInferenceItemRequest[];
  readonly abortSignal?: AbortSignal;
}

export interface BatchInferenceProviderSubmitResult {
  readonly providerBatchId: BatchInferenceProviderBatchId;
  readonly providerJobStatus: BatchInferenceProviderJobStatus;
}

export interface BatchInferenceProviderStatusResult {
  readonly providerBatchId: BatchInferenceProviderBatchId;
  readonly providerJobStatus: BatchInferenceProviderJobStatus;
  readonly requestCounts?: {
    readonly total?: number;
    readonly completed?: number;
    readonly failed?: number;
  };
  readonly outputFileId?: string;
  readonly errorFileId?: string;
}

export interface BatchInferenceProviderItemResult {
  readonly providerCorrelationId: BatchInferenceProviderCorrelationId;
  readonly result?: GenerateCompletionResult;
  readonly usage?: ModelUsage;
  readonly error?: BatchInferenceItemError;
}

export interface BatchInferenceProviderResultsPage {
  readonly items: readonly BatchInferenceProviderItemResult[];
  readonly done: boolean;
}

/**
 * Provider-native batch port. Implementations live in model adapters only.
 */
export interface BatchInferenceProviderAdapter {
  readonly provider: ModelProvider;

  checkCapabilities(): {
    readonly supported: boolean;
    readonly reasons: readonly string[];
  };

  submit(
    request: BatchInferenceProviderSubmitRequest,
  ): Promise<BatchInferenceProviderSubmitResult>;

  getStatus(
    providerBatchId: BatchInferenceProviderBatchId,
    options?: { readonly abortSignal?: AbortSignal },
  ): Promise<BatchInferenceProviderStatusResult>;

  requestCancellation(
    providerBatchId: BatchInferenceProviderBatchId,
    options?: { readonly abortSignal?: AbortSignal },
  ): Promise<BatchInferenceProviderStatusResult>;

  fetchResults(
    providerBatchId: BatchInferenceProviderBatchId,
    options?: {
      readonly abortSignal?: AbortSignal;
      readonly outputFileId?: string;
      readonly errorFileId?: string;
    },
  ): Promise<BatchInferenceProviderResultsPage>;
}

export function mapOpenAiBatchStatus(
  status: string,
): BatchInferenceProviderJobStatus {
  switch (status) {
    case "validating":
      return "VALIDATING";
    case "in_progress":
    case "finalizing":
      return "IN_PROGRESS";
    case "completed":
      return "COMPLETED";
    case "failed":
      return "FAILED";
    case "cancelling":
      return "CANCELLING";
    case "cancelled":
      return "CANCELLED";
    case "expired":
      return "EXPIRED";
    default:
      return "UNKNOWN";
  }
}

export function mapAnthropicBatchStatus(
  status: string,
): BatchInferenceProviderJobStatus {
  switch (status) {
    case "in_progress":
      return "IN_PROGRESS";
    case "ended":
      return "COMPLETED";
    case "canceling":
      return "CANCELLING";
    case "canceled":
      return "CANCELLED";
    default:
      return "UNKNOWN";
  }
}

export function mapGeminiBatchStatus(
  state: string,
): BatchInferenceProviderJobStatus {
  switch (state) {
    case "BATCH_STATE_PENDING":
    case "BATCH_STATE_RUNNING":
      return "IN_PROGRESS";
    case "BATCH_STATE_SUCCEEDED":
      return "COMPLETED";
    case "BATCH_STATE_FAILED":
      return "FAILED";
    case "BATCH_STATE_CANCELLED":
      return "CANCELLED";
    case "BATCH_STATE_EXPIRED":
      return "EXPIRED";
    default:
      return "UNKNOWN";
  }
}
