/** Faithfulness = supported evaluable claims / total evaluable claims. */
export function scoreFaithfulnessFromClaims(
  claims: readonly { readonly supported: boolean }[],
): number | null {
  if (claims.length === 0) {
    return null;
  }
  const supported = claims.filter((claim) => claim.supported).length;
  return supported / claims.length;
}

/**
 * Average precision over ordered chunks (binary relevance).
 * Score is mean of precision@k at each relevant position, divided by count of relevant items.
 * Returns 0 when no chunk is relevant.
 */
export function averagePrecisionOverRankedChunks(
  relevanceByRankOrder: readonly boolean[],
): number {
  if (relevanceByRankOrder.length === 0) {
    return 0;
  }
  let relevantSoFar = 0;
  let totalRelevant = 0;
  let precisionSum = 0;

  for (let index = 0; index < relevanceByRankOrder.length; index += 1) {
    if (relevanceByRankOrder[index]) {
      relevantSoFar += 1;
      totalRelevant += 1;
      precisionSum += relevantSoFar / (index + 1);
    }
  }

  if (totalRelevant === 0) {
    return 0;
  }
  return precisionSum / totalRelevant;
}

export function scoreContextRecallFromFacts(
  facts: readonly { readonly supported: boolean }[],
): number | null {
  if (facts.length === 0) {
    return null;
  }
  const supported = facts.filter((fact) => fact.supported).length;
  return supported / facts.length;
}
