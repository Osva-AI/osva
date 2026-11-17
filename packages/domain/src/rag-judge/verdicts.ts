import {
  JUDGE_VERDICT_EVIDENCE_ITEM_MAX_LENGTH,
  JUDGE_VERDICT_EVIDENCE_MAX_ITEMS,
  JUDGE_VERDICT_REASON_MAX_LENGTH,
  RAG_EVALUATOR_CLAIM_EXPLANATION_MAX_LENGTH,
  RAG_EVALUATOR_CLAIM_ID_MAX_LENGTH,
  RAG_EVALUATOR_CLAIM_STATEMENT_MAX_LENGTH,
  RAG_EVALUATOR_MAX_CLAIMS,
} from "@osva-ai/contracts";

import { deriveJudgePassFail } from "../llm-judge/verdict.js";
import {
  averagePrecisionOverRankedChunks,
  scoreContextRecallFromFacts,
  scoreFaithfulnessFromClaims,
} from "./scoring.js";

function isUnitInterval(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function parseJsonObject(
  raw: string,
):
  | { readonly ok: true; readonly record: Record<string, unknown> }
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
  return { ok: true, record: parsed as Record<string, unknown> };
}

function parseScoreReasonEvidence(record: Record<string, unknown>):
  | {
      readonly ok: true;
      readonly score: number;
      readonly reason: string;
      readonly evidence: string[];
      readonly confidence?: number;
    }
  | { readonly ok: false; readonly errorCode: string } {
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
    score: record.score,
    reason: record.reason,
    evidence,
    ...(record.confidence === undefined
      ? {}
      : { confidence: record.confidence }),
  };
}

export const RAG_SCORE_VERDICT_JSON_SCHEMA = {
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

export function parseRagScoreVerdictJson(raw: string) {
  const objectParse = parseJsonObject(raw);
  if (!objectParse.ok) {
    return objectParse;
  }
  return parseScoreReasonEvidence(objectParse.record);
}

const claimItemSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "statement", "supported"],
  properties: {
    id: {
      type: "string",
      minLength: 1,
      maxLength: RAG_EVALUATOR_CLAIM_ID_MAX_LENGTH,
    },
    statement: {
      type: "string",
      minLength: 1,
      maxLength: RAG_EVALUATOR_CLAIM_STATEMENT_MAX_LENGTH,
    },
    supported: { type: "boolean" },
    supportingChunkIds: {
      type: "array",
      maxItems: 16,
      items: { type: "string", minLength: 1, maxLength: 128 },
    },
    explanation: {
      type: "string",
      minLength: 1,
      maxLength: RAG_EVALUATOR_CLAIM_EXPLANATION_MAX_LENGTH,
    },
  },
} as const;

export const RAG_FAITHFULNESS_VERDICT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reason", "claims"],
  properties: {
    reason: {
      type: "string",
      minLength: 1,
      maxLength: JUDGE_VERDICT_REASON_MAX_LENGTH,
    },
    claims: {
      type: "array",
      maxItems: RAG_EVALUATOR_MAX_CLAIMS,
      items: claimItemSchema,
    },
  },
} as const;

export const RAG_CONTEXT_RECALL_VERDICT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reason", "facts"],
  properties: {
    reason: {
      type: "string",
      minLength: 1,
      maxLength: JUDGE_VERDICT_REASON_MAX_LENGTH,
    },
    facts: {
      type: "array",
      maxItems: RAG_EVALUATOR_MAX_CLAIMS,
      items: claimItemSchema,
    },
  },
} as const;

export const RAG_CONTEXT_PRECISION_VERDICT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reason", "chunkAssessments"],
  properties: {
    reason: {
      type: "string",
      minLength: 1,
      maxLength: JUDGE_VERDICT_REASON_MAX_LENGTH,
    },
    chunkAssessments: {
      type: "array",
      maxItems: 32,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["chunkId", "relevant"],
        properties: {
          chunkId: { type: "string", minLength: 1, maxLength: 128 },
          relevant: { type: "boolean" },
        },
      },
    },
  },
} as const;

function parseClaimAssessments(
  record: Record<string, unknown>,
  listKey: "claims" | "facts",
  allowedChunkIds: ReadonlySet<string>,
) {
  const allowed = new Set([listKey, "reason"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      return { ok: false as const, errorCode: "judge_unexpected_field" };
    }
  }
  if (
    typeof record.reason !== "string" ||
    record.reason.length === 0 ||
    record.reason.length > JUDGE_VERDICT_REASON_MAX_LENGTH
  ) {
    return { ok: false as const, errorCode: "judge_invalid_reason" };
  }
  const list = record[listKey];
  if (!Array.isArray(list)) {
    return { ok: false as const, errorCode: "rag_invalid_assessment_list" };
  }
  if (list.length > RAG_EVALUATOR_MAX_CLAIMS) {
    return { ok: false as const, errorCode: "rag_oversized_assessment_list" };
  }

  const ids = new Set<string>();
  const parsed: Array<{
    readonly id: string;
    readonly statement: string;
    readonly supported: boolean;
    readonly supportingChunkIds?: readonly string[];
    readonly explanation?: string;
  }> = [];

  for (const item of list) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { ok: false as const, errorCode: "rag_invalid_assessment_item" };
    }
    const row = item as Record<string, unknown>;
    const itemAllowed = new Set([
      "id",
      "statement",
      "supported",
      "supportingChunkIds",
      "explanation",
    ]);
    for (const key of Object.keys(row)) {
      if (!itemAllowed.has(key)) {
        return { ok: false as const, errorCode: "judge_unexpected_field" };
      }
    }

    if (
      typeof row.id !== "string" ||
      row.id.length === 0 ||
      row.id.length > RAG_EVALUATOR_CLAIM_ID_MAX_LENGTH
    ) {
      return { ok: false as const, errorCode: "rag_invalid_claim_id" };
    }
    if (ids.has(row.id)) {
      return { ok: false as const, errorCode: "rag_duplicate_claim_id" };
    }
    ids.add(row.id);

    if (
      typeof row.statement !== "string" ||
      row.statement.length === 0 ||
      row.statement.length > RAG_EVALUATOR_CLAIM_STATEMENT_MAX_LENGTH
    ) {
      return { ok: false as const, errorCode: "rag_invalid_claim_statement" };
    }
    if (typeof row.supported !== "boolean") {
      return { ok: false as const, errorCode: "rag_invalid_support_label" };
    }

    let supportingChunkIds: string[] | undefined;
    if (row.supportingChunkIds !== undefined) {
      if (!Array.isArray(row.supportingChunkIds)) {
        return { ok: false as const, errorCode: "rag_invalid_chunk_reference" };
      }
      supportingChunkIds = [];
      for (const chunkId of row.supportingChunkIds) {
        if (typeof chunkId !== "string" || chunkId.length === 0) {
          return {
            ok: false as const,
            errorCode: "rag_invalid_chunk_reference",
          };
        }
        if (!allowedChunkIds.has(chunkId)) {
          return {
            ok: false as const,
            errorCode: "rag_unknown_chunk_reference",
          };
        }
        supportingChunkIds.push(chunkId);
      }
    }

    let explanation: string | undefined;
    if (row.explanation !== undefined) {
      if (
        typeof row.explanation !== "string" ||
        row.explanation.length === 0 ||
        row.explanation.length > RAG_EVALUATOR_CLAIM_EXPLANATION_MAX_LENGTH
      ) {
        return { ok: false as const, errorCode: "rag_invalid_explanation" };
      }
      explanation = row.explanation;
    }

    parsed.push({
      id: row.id,
      statement: row.statement,
      supported: row.supported,
      ...(supportingChunkIds === undefined ? {} : { supportingChunkIds }),
      ...(explanation === undefined ? {} : { explanation }),
    });
  }

  return {
    ok: true as const,
    reason: record.reason,
    assessments: parsed,
  };
}

export function parseFaithfulnessVerdictJson(
  raw: string,
  allowedChunkIds: ReadonlySet<string>,
) {
  const objectParse = parseJsonObject(raw);
  if (!objectParse.ok) {
    return objectParse;
  }
  const claimsParse = parseClaimAssessments(
    objectParse.record,
    "claims",
    allowedChunkIds,
  );
  if (!claimsParse.ok) {
    return claimsParse;
  }

  const score = scoreFaithfulnessFromClaims(claimsParse.assessments);
  return {
    ok: true as const,
    score: score ?? 0,
    reason: claimsParse.reason,
    evidence: [] as string[],
    metricDetails: { claims: claimsParse.assessments },
    noEvaluableClaims: score === null,
  };
}

export function parseContextRecallVerdictJson(
  raw: string,
  allowedChunkIds: ReadonlySet<string>,
  expectedFactIds: readonly string[],
) {
  const objectParse = parseJsonObject(raw);
  if (!objectParse.ok) {
    return objectParse;
  }
  const factsParse = parseClaimAssessments(
    objectParse.record,
    "facts",
    allowedChunkIds,
  );
  if (!factsParse.ok) {
    return factsParse;
  }

  if (expectedFactIds.length > 0) {
    const returnedIds = new Set(factsParse.assessments.map((fact) => fact.id));
    for (const expectedId of expectedFactIds) {
      if (!returnedIds.has(expectedId)) {
        return { ok: false as const, errorCode: "rag_missing_fact_assessment" };
      }
    }
    if (returnedIds.size !== expectedFactIds.length) {
      return { ok: false as const, errorCode: "rag_extra_fact_assessment" };
    }
  }

  const score = scoreContextRecallFromFacts(factsParse.assessments);
  if (score === null) {
    return { ok: false as const, errorCode: "rag_empty_fact_assessments" };
  }
  return {
    ok: true as const,
    score,
    reason: factsParse.reason,
    evidence: [],
    metricDetails: { facts: factsParse.assessments },
  };
}

export function parseContextPrecisionVerdictJson(
  raw: string,
  chunkIdsByRank: readonly string[],
) {
  const objectParse = parseJsonObject(raw);
  if (!objectParse.ok) {
    return objectParse;
  }
  const allowed = new Set(["reason", "chunkAssessments"]);
  for (const key of Object.keys(objectParse.record)) {
    if (!allowed.has(key)) {
      return { ok: false as const, errorCode: "judge_unexpected_field" };
    }
  }
  if (
    typeof objectParse.record.reason !== "string" ||
    objectParse.record.reason.length === 0
  ) {
    return { ok: false as const, errorCode: "judge_invalid_reason" };
  }
  const assessments = objectParse.record.chunkAssessments;
  if (!Array.isArray(assessments)) {
    return { ok: false as const, errorCode: "rag_invalid_chunk_assessments" };
  }
  if (assessments.length !== chunkIdsByRank.length) {
    return {
      ok: false as const,
      errorCode: "rag_incomplete_chunk_assessments",
    };
  }

  const byId = new Map<string, boolean>();
  for (const item of assessments) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { ok: false as const, errorCode: "rag_invalid_chunk_assessment" };
    }
    const row = item as Record<string, unknown>;
    if (typeof row.chunkId !== "string" || typeof row.relevant !== "boolean") {
      return { ok: false as const, errorCode: "rag_invalid_chunk_assessment" };
    }
    if (byId.has(row.chunkId)) {
      return {
        ok: false as const,
        errorCode: "rag_duplicate_chunk_assessment",
      };
    }
    byId.set(row.chunkId, row.relevant);
  }

  const relevance: boolean[] = [];
  for (const chunkId of chunkIdsByRank) {
    const label = byId.get(chunkId);
    if (label === undefined) {
      return { ok: false as const, errorCode: "rag_unknown_chunk_id" };
    }
    relevance.push(label);
  }

  const score = averagePrecisionOverRankedChunks(relevance);
  return {
    ok: true as const,
    score,
    reason: objectParse.record.reason,
    evidence: [],
    metricDetails: {
      chunkAssessments: chunkIdsByRank.map((chunkId) => ({
        chunkId,
        relevant: byId.get(chunkId)!,
      })),
    },
  };
}

export function deriveRagPassFail(
  score: number,
  minPassingScore: number,
): boolean {
  return deriveJudgePassFail(score, minPassingScore);
}
