import {
  JUDGE_VERDICT_EVIDENCE_ITEM_MAX_LENGTH,
  JUDGE_VERDICT_EVIDENCE_MAX_ITEMS,
  JUDGE_VERDICT_REASON_MAX_LENGTH,
  type EvaluationComparisonPairwisePreference,
} from "@osva-ai/contracts";

import {
  AB_PAIRWISE_SLOT_PREFERENCES,
  mapAbPreferenceToCanonical,
  type AbPairwiseSlotPreference,
} from "./pairwise-preference-map.js";
import type { EvaluationComparisonPairwiseJudgmentPosition } from "@osva-ai/contracts";

export interface PairwiseVerdict {
  readonly slotPreference: AbPairwiseSlotPreference;
  readonly canonicalPreference: EvaluationComparisonPairwisePreference;
  readonly reason: string;
  readonly evidence: readonly string[];
  readonly confidence?: number;
}

export const PAIRWISE_VERDICT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["preference", "reason", "evidence"],
  properties: {
    preference: { type: "string", enum: [...AB_PAIRWISE_SLOT_PREFERENCES] },
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

export function parsePairwiseVerdictJson(
  raw: string,
  judgmentPosition: EvaluationComparisonPairwiseJudgmentPosition,
):
  | { readonly ok: true; readonly verdict: PairwiseVerdict }
  | { readonly ok: false; readonly errorCode: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, errorCode: "pairwise_empty_response" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return { ok: false, errorCode: "pairwise_invalid_json" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, errorCode: "pairwise_invalid_shape" };
  }
  const record = parsed as Record<string, unknown>;
  const allowed = new Set(["preference", "reason", "evidence", "confidence"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      return { ok: false, errorCode: "pairwise_unexpected_field" };
    }
  }
  if (
    typeof record.preference !== "string" ||
    !(AB_PAIRWISE_SLOT_PREFERENCES as readonly string[]).includes(
      record.preference,
    )
  ) {
    return { ok: false, errorCode: "pairwise_invalid_preference" };
  }
  const slotPreference = record.preference as AbPairwiseSlotPreference;
  if (
    typeof record.reason !== "string" ||
    record.reason.length === 0 ||
    record.reason.length > JUDGE_VERDICT_REASON_MAX_LENGTH
  ) {
    return { ok: false, errorCode: "pairwise_invalid_reason" };
  }
  if (!Array.isArray(record.evidence)) {
    return { ok: false, errorCode: "pairwise_invalid_evidence" };
  }
  const evidence: string[] = [];
  for (const item of record.evidence) {
    if (
      typeof item !== "string" ||
      item.length === 0 ||
      item.length > JUDGE_VERDICT_EVIDENCE_ITEM_MAX_LENGTH
    ) {
      return { ok: false, errorCode: "pairwise_invalid_evidence" };
    }
    evidence.push(item);
  }
  if (
    record.confidence !== undefined &&
    (typeof record.confidence !== "number" ||
      !Number.isFinite(record.confidence) ||
      record.confidence < 0 ||
      record.confidence > 1)
  ) {
    return { ok: false, errorCode: "pairwise_invalid_confidence" };
  }

  return {
    ok: true,
    verdict: {
      slotPreference,
      canonicalPreference: mapAbPreferenceToCanonical(
        judgmentPosition,
        slotPreference,
      ),
      reason: record.reason,
      evidence,
      ...(record.confidence === undefined
        ? {}
        : { confidence: record.confidence }),
    },
  };
}
