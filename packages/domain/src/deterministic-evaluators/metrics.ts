/** Deterministic text metrics (EvalRoom-inspired; reimplemented for OSVA). */

export function tokenizeForMetrics(text: string): string[] {
  const normalized = text.trim().toLowerCase();
  if (normalized.length === 0) {
    return [];
  }
  return normalized.split(/\s+/);
}

function tokenMultisetOverlap(
  candidateTokens: string[],
  referenceTokens: string[],
): number {
  if (candidateTokens.length === 0 || referenceTokens.length === 0) {
    return 0;
  }
  const referenceCounts = new Map<string, number>();
  for (const token of referenceTokens) {
    referenceCounts.set(token, (referenceCounts.get(token) ?? 0) + 1);
  }
  let overlap = 0;
  for (const token of candidateTokens) {
    const count = referenceCounts.get(token) ?? 0;
    if (count > 0) {
      overlap += 1;
      referenceCounts.set(token, count - 1);
    }
  }
  return overlap;
}

export function exactMatchText(
  candidate: string,
  reference: string,
  caseSensitive: boolean,
  trimWhitespace: boolean,
): boolean {
  const left = trimWhitespace ? candidate.trim() : candidate;
  const right = trimWhitespace ? reference.trim() : reference;
  return caseSensitive
    ? left === right
    : left.toLowerCase() === right.toLowerCase();
}

export function tokenF1Score(candidate: string, reference: string): number {
  const candidateTokens = tokenizeForMetrics(candidate);
  const referenceTokens = tokenizeForMetrics(reference);
  if (candidateTokens.length === 0 && referenceTokens.length === 0) {
    return 1;
  }
  if (candidateTokens.length === 0 || referenceTokens.length === 0) {
    return 0;
  }
  const overlap = tokenMultisetOverlap(candidateTokens, referenceTokens);
  if (overlap === 0) {
    return 0;
  }
  const precision = overlap / candidateTokens.length;
  const recall = overlap / referenceTokens.length;
  return (2 * precision * recall) / (precision + recall);
}

function ngramCounts(tokens: string[], n: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = 0; index <= tokens.length - n; index += 1) {
    const key = tokens.slice(index, index + n).join("\u0001");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function sentenceBleuScore(
  candidate: string,
  reference: string,
): number {
  const candidateTokens = tokenizeForMetrics(candidate);
  const referenceTokens = tokenizeForMetrics(reference);
  if (candidateTokens.length === 0 || referenceTokens.length === 0) {
    return 0;
  }

  const maxN = Math.min(4, candidateTokens.length);
  let logSum = 0;
  for (let n = 1; n <= maxN; n += 1) {
    const candidateNgrams = ngramCounts(candidateTokens, n);
    const referenceNgrams = ngramCounts(referenceTokens, n);
    let clipped = 0;
    let total = 0;
    candidateNgrams.forEach((count, ngram) => {
      total += count;
      clipped += Math.min(count, referenceNgrams.get(ngram) ?? 0);
    });
    if (total === 0 || clipped === 0) {
      return 0;
    }
    logSum += Math.log(clipped / total);
  }
  const geometricMean = Math.exp(logSum / maxN);
  const brevityPenalty =
    candidateTokens.length > referenceTokens.length
      ? 1
      : Math.exp(1 - referenceTokens.length / candidateTokens.length);
  const score = brevityPenalty * geometricMean;
  return clampUnitInterval(score);
}

export function rougeLcsLength(left: string[], right: string[]): number {
  const m = left.length;
  const n = right.length;
  if (m === 0 || n === 0) {
    return 0;
  }
  let previous = new Array<number>(n + 1).fill(0);
  let current = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const leftToken = left[i - 1];
      const rightToken = right[j - 1];
      if (leftToken === undefined || rightToken === undefined) {
        current[j] = Math.max(previous[j] ?? 0, current[j - 1] ?? 0);
        continue;
      }
      current[j] =
        leftToken === rightToken
          ? (previous[j - 1] ?? 0) + 1
          : Math.max(previous[j] ?? 0, current[j - 1] ?? 0);
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[n] ?? 0;
}

export function rougeLScore(candidate: string, reference: string): number {
  const candidateTokens = tokenizeForMetrics(candidate);
  const referenceTokens = tokenizeForMetrics(reference);
  if (candidateTokens.length === 0 && referenceTokens.length === 0) {
    return 1;
  }
  if (candidateTokens.length === 0 || referenceTokens.length === 0) {
    return 0;
  }
  const lcs = rougeLcsLength(candidateTokens, referenceTokens);
  const precision = lcs / candidateTokens.length;
  const recall = lcs / referenceTokens.length;
  if (precision + recall === 0) {
    return 0;
  }
  return (2 * precision * recall) / (precision + recall);
}

export function clampUnitInterval(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  if (score < 0) {
    return 0;
  }
  if (score > 1) {
    return 1;
  }
  return score;
}
