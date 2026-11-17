import {
  JUDGE_VERDICT_EVIDENCE_ITEM_MAX_LENGTH,
  JUDGE_VERDICT_EVIDENCE_MAX_ITEMS,
  JUDGE_VERDICT_REASON_MAX_LENGTH,
} from "@osva-ai/contracts";

export interface JudgeVerdict {
  readonly score: number;
  readonly reason: string;
  readonly evidence: readonly string[];
  readonly confidence?: number;
}

export const JUDGE_VERDICT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "reason", "evidence"],
  properties: {
    score: { type: "number", minimum: 0, maximum: 1 },
    reason: {
      type: "string",
      minLength: 1,
      maxLength: JUDGE_VERDICT_REASON_MAX_LENGTH,
    },
    evidence: {
      type: "array",
      maxItems: JUDGE_VERDICT_EVIDENCE_MAX_ITEMS,
      items: {
        type: "string",
        minLength: 1,
        maxLength: JUDGE_VERDICT_EVIDENCE_ITEM_MAX_LENGTH,
      },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

function isUnitInterval(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

export function parseJudgeVerdictJson(
  raw: string,
):
  | { readonly ok: true; readonly verdict: JudgeVerdict }
  | { readonly ok: false; readonly errorCode: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, errorCode: "judge_empty_response" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return { ok: false, errorCode: "judge_invalid_json" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, errorCode: "judge_invalid_verdict_shape" };
  }

  const record = parsed as Record<string, unknown>;
  const allowed = new Set(["score", "reason", "evidence", "confidence"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      return { ok: false, errorCode: "judge_unexpected_field" };
    }
  }

  if (!isUnitInterval(record.score)) {
    return { ok: false, errorCode: "judge_invalid_score" };
  }

  if (
    typeof record.reason !== "string" ||
    record.reason.length === 0 ||
    record.reason.length > JUDGE_VERDICT_REASON_MAX_LENGTH
  ) {
    return { ok: false, errorCode: "judge_invalid_reason" };
  }

  if (!Array.isArray(record.evidence)) {
    return { ok: false, errorCode: "judge_invalid_evidence" };
  }
  if (record.evidence.length > JUDGE_VERDICT_EVIDENCE_MAX_ITEMS) {
    return { ok: false, errorCode: "judge_oversized_evidence" };
  }

  const evidence: string[] = [];
  for (const item of record.evidence) {
    if (
      typeof item !== "string" ||
      item.length === 0 ||
      item.length > JUDGE_VERDICT_EVIDENCE_ITEM_MAX_LENGTH
    ) {
      return { ok: false, errorCode: "judge_invalid_evidence" };
    }
    evidence.push(item);
  }

  if (record.confidence !== undefined && !isUnitInterval(record.confidence)) {
    return { ok: false, errorCode: "judge_invalid_confidence" };
  }

  return {
    ok: true,
    verdict: {
      score: record.score,
      reason: record.reason,
      evidence,
      ...(record.confidence === undefined
        ? {}
        : { confidence: record.confidence }),
    },
  };
}

export function deriveJudgePassFail(
  score: number,
  minPassingScore: number,
): boolean {
  return score >= minPassingScore;
}
