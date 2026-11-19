import type { InferenceRoutingCostEstimate } from "@osva-ai/contracts";
import type { InferenceRoutingLatencyObservation } from "@osva-ai/contracts";

const BALANCED_COST_RANK_WEIGHT = 1_000;
const BALANCED_LATENCY_RANK_WEIGHT = 10;
const BALANCED_POLICY_INDEX_WEIGHT = 1;
const BALANCED_UNKNOWN_RANK_PENALTY = 10_000;

export interface BalancedRankInput {
  readonly policyIndex: number;
  readonly cost: InferenceRoutingCostEstimate;
  readonly latency: InferenceRoutingLatencyObservation;
  readonly costRank: number;
  readonly latencyRank: number;
}

export function assignBalancedRanks<
  T extends {
    readonly policyIndex: number;
    readonly cost: InferenceRoutingCostEstimate;
    readonly latency: InferenceRoutingLatencyObservation;
  },
>(candidates: readonly T[]): BalancedRankInput[] {
  const priced = candidates
    .map((c, index) => ({
      index,
      cost: c.cost.estimatedCostUsdMicros,
    }))
    .filter((row): row is { index: number; cost: number } => row.cost !== null)
    .sort((a, b) => a.cost - b.cost || a.index - b.index);

  const costRankByIndex = new Map<number, number>();
  priced.forEach((row, rank) => costRankByIndex.set(row.index, rank));

  const latencies = candidates
    .map((c, index) => ({
      index,
      median: c.latency.medianCompletionMs,
      sufficient: c.latency.sufficientEvidence,
    }))
    .filter(
      (row): row is { index: number; median: number; sufficient: true } =>
        row.sufficient === true && row.median !== null,
    )
    .sort((a, b) => a.median - b.median || a.index - b.index);

  const latencyRankByIndex = new Map<number, number>();
  latencies.forEach((row, rank) => latencyRankByIndex.set(row.index, rank));

  return candidates.map((candidate, index) => ({
    policyIndex: candidate.policyIndex,
    cost: candidate.cost,
    latency: candidate.latency,
    costRank:
      costRankByIndex.get(index) ??
      priced.length + BALANCED_UNKNOWN_RANK_PENALTY,
    latencyRank:
      latencyRankByIndex.get(index) ??
      latencies.length + BALANCED_UNKNOWN_RANK_PENALTY,
  }));
}

export function balancedSortKey(input: BalancedRankInput): number {
  return (
    input.costRank * BALANCED_COST_RANK_WEIGHT +
    input.latencyRank * BALANCED_LATENCY_RANK_WEIGHT +
    input.policyIndex * BALANCED_POLICY_INDEX_WEIGHT
  );
}
