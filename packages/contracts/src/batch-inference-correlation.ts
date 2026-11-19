import type {
  BatchInferenceItemOutcome,
  BatchInferenceReconciliationReport,
} from "./batch-inference.js";
import type { BatchInferenceItemId } from "./ids.js";

export function buildBatchInferenceItemIdSet(
  itemIds: readonly BatchInferenceItemId[],
): Set<BatchInferenceItemId> {
  return new Set(itemIds);
}

export function validateUniqueBatchInferenceItemIds(
  itemIds: readonly BatchInferenceItemId[],
): { ok: true } | { ok: false; duplicateId: BatchInferenceItemId } {
  const seen = new Set<BatchInferenceItemId>();
  for (const id of itemIds) {
    if (seen.has(id)) {
      return { ok: false, duplicateId: id };
    }
    seen.add(id);
  }
  return { ok: true };
}

export interface BatchInferenceProviderCorrelationPartition {
  readonly duplicateCorrelationIds: readonly string[];
  readonly unexpectedCorrelationIds: readonly string[];
  readonly missingCorrelationIds: readonly string[];
  readonly hasCorrelationAnomaly: boolean;
}

/**
 * Validates provider result correlation ids before applying outcomes to local items.
 * Duplicate and unexpected ids must not be mapped to items.
 */
export function partitionBatchInferenceProviderCorrelations<
  T extends { readonly providerCorrelationId: string },
>(
  expectedCorrelationIds: readonly string[],
  providerItems: readonly T[],
): {
  readonly applicable: readonly T[];
} & BatchInferenceProviderCorrelationPartition {
  const expected = new Set(expectedCorrelationIds);
  const seen = new Set<string>();
  const applicable: T[] = [];
  const duplicateCorrelationIds: string[] = [];
  const unexpectedCorrelationIds: string[] = [];

  for (const item of providerItems) {
    const correlationId = item.providerCorrelationId;
    if (!expected.has(correlationId)) {
      unexpectedCorrelationIds.push(correlationId);
      continue;
    }
    if (seen.has(correlationId)) {
      duplicateCorrelationIds.push(correlationId);
      continue;
    }
    seen.add(correlationId);
    applicable.push(item);
  }

  const missingCorrelationIds = expectedCorrelationIds.filter(
    (id) => !seen.has(id),
  );

  return {
    applicable,
    duplicateCorrelationIds,
    unexpectedCorrelationIds,
    missingCorrelationIds,
    hasCorrelationAnomaly:
      duplicateCorrelationIds.length > 0 || unexpectedCorrelationIds.length > 0,
  };
}

export function formatBatchInferenceCorrelationAnomalyNote(
  partition: BatchInferenceProviderCorrelationPartition,
): string {
  return `provider_correlation_anomaly unexpected=${String(partition.unexpectedCorrelationIds.length)} duplicate=${String(partition.duplicateCorrelationIds.length)}`;
}

export function reconcileBatchInferenceItemOutcomes(
  expectedItemIds: readonly BatchInferenceItemId[],
  outcomes: readonly BatchInferenceItemOutcome[],
): BatchInferenceReconciliationReport {
  const expected = buildBatchInferenceItemIdSet(expectedItemIds);
  const seen = new Set<BatchInferenceItemId>();
  const duplicateItemIds: BatchInferenceItemId[] = [];
  const unexpectedItemIds: BatchInferenceItemId[] = [];
  const byId = new Map<BatchInferenceItemId, BatchInferenceItemOutcome>();

  for (const outcome of outcomes) {
    const { itemId } = outcome;
    if (seen.has(itemId)) {
      duplicateItemIds.push(itemId);
      continue;
    }
    seen.add(itemId);
    if (!expected.has(itemId)) {
      unexpectedItemIds.push(itemId);
    }
    byId.set(itemId, outcome);
  }

  const missingItemIds: BatchInferenceItemId[] = [];
  for (const id of expected) {
    if (!seen.has(id)) {
      missingItemIds.push(id);
    }
  }

  const matchedCount = expectedItemIds.length - missingItemIds.length;
  const isComplete =
    duplicateItemIds.length === 0 &&
    unexpectedItemIds.length === 0 &&
    missingItemIds.length === 0;

  return {
    expectedCount: expectedItemIds.length,
    receivedCount: outcomes.length,
    matchedCount,
    missingItemIds,
    duplicateItemIds,
    unexpectedItemIds,
    isComplete,
  };
}
