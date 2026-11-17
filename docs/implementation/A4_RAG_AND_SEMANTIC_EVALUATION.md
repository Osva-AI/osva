# A4: RAG and Semantic Evaluation

## Supported evaluator types

- `RAG_FAITHFULNESS`
- `RAG_ANSWER_RELEVANCE`
- `RAG_CONTEXT_PRECISION`
- `RAG_CONTEXT_RECALL`
- `SEMANTIC_SIMILARITY`

All five reuse **A3 durable judge tasks** (`evaluation_judge_tasks`), `ProcessEvaluationJudgeTasks`, ModelGateway authorization, invocation accounting, recovery, and quality gates. No second runner or database.

`SEMANTIC_SIMILARITY` is **judge-rated semantic similarity** (not embedding cosine). Passing similarity uses a versioned judge rubric and strict normalized score in `[0,1]`.

## Context evidence

Authoritative retrieval evidence is an **immutable suite snapshot** on `EvaluationCase.expected`:

```json
{
  "schemaVersion": "a4.0",
  "context": {
    "chunks": [
      { "id": "chunk-1", "text": "...", "rank": 1, "sourceId": "source-1" }
    ]
  },
  "referenceAnswer": "...",
  "referenceFacts": [{ "id": "f1", "statement": "..." }]
}
```

Bounds and validation: `packages/contracts/src/schemas/evaluation-rag.ts`.

**Runtime retrieval replay is not implemented.** KNOWLEDGE run steps record operational metadata only; evaluation does not rerun mutable indexes and treat results as execution evidence.

Missing required evidence yields **ERROR** with explicit codes (for example `rag_missing_context`, `rag_missing_reference`) — not score `0`.

## Scoring (computed in OSVA)

| Metric | Formula |
|--------|---------|
| Faithfulness | `supported_claims / total_evaluable_claims` from structured claim labels |
| Answer relevance | Judge `score` in `[0,1]` (validated); pass/fail from threshold |
| Context precision | Average precision over rank-ordered binary relevance labels (AP-style; OSVA-owned) |
| Context recall | `supported_reference_facts / total_reference_facts` |
| Semantic similarity | Judge `score` in `[0,1]` |

Malformed structured verdicts → **ERROR**. `RAG_FAITHFULNESS` with no evaluable claims: policy `ERROR` (default) or `NOT_APPLICABLE` (`errorCode: rag_not_applicable`).

## Configuration

Judge-backed RAG evaluators share: `modelProfileVersionId`, optional `minPassingScore`, `maxOutputTokens`, `instructions`. Snapshotted per immutable `EvaluationSuiteVersion`. Implementation `a4.0`, prompt template `a4.0`.

## Prompt injection

Untrusted content (question, answer, context chunks) is wrapped in labeled boundaries. Rubric, thresholds, and model binding stay outside untrusted sections. Judges receive no tools or credentials.

## Integration with A3

Scheduling: `ensureJudgeBackedTaskForTerminalRun`. Execution: `buildJudgeMetricPlan` dispatches prompt + JSON schema + parser. Deferred synchronous evaluation: `judge_execution_deferred`.

## Limitations (deferred A5)

- No multi-metric weighting per case
- No runtime-context capture from child runs
- No embedding-gateway semantic metric path in this slice