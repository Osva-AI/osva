# A1 — Deterministic evaluation evaluators

## Registry

Suite and run reconciliation use `@osva/domain` deterministic evaluators
(`packages/domain/src/deterministic-evaluators/`). Configuration is validated
with `evaluatorConfigSchema` in `@osva-ai/contracts`.

Implementation version: `a1.0` (`DETERMINISTIC_EVALUATOR_IMPLEMENTATION_VERSION`).

## Supported types

| Type | Purpose |
| --- | --- |
| `JSON_EXACT_MATCH` | Canonical JSON deep equality (legacy default) |
| `TEXT_EXACT_MATCH` | Trimmed string equality with optional case sensitivity |
| `TOKEN_F1` | Lowercase whitespace token multiset F1 |
| `BLEU` | Sentence-level BLEU-4 with brevity penalty |
| `ROUGE_L` | Token-level ROUGE-L F-measure (bounded LCS) |
| `JSON_VALID` | Full-string JSON parse for text output; structured output is already canonical JSON |
| `REQUIRED_CONCEPTS` | Case-insensitive substring coverage score |
| `FORBIDDEN_CONCEPTS` | Fail when forbidden substrings appear |

Direct `POST /v1/evaluations` remains **`JSON_EXACT_MATCH` only** (persisted
`evaluations` table constraint unchanged).

## Configuration defaults

- `TEXT_EXACT_MATCH`: `caseSensitive=false`, `trimWhitespace=true`
- `TOKEN_F1` / `BLEU` / `ROUGE_L`: `minPassingScore=0.5`
- `REQUIRED_CONCEPTS`: `minPassingScore=1` (all concepts required unless lowered)

Reference text may live on `evaluator.reference` or, when a string, on case
`expected` (JSON_EXACT_MATCH continues to prefer `evaluator.expected ?? expected`).

## Tokenization

Metrics tokenize with `trim → lowercase → split on whitespace`. Repeated tokens
use multiset overlap (F1, BLEU n-gram clipping).

## Result contract (`evaluatorResults` JSONB)

Completed:

```json
{
  "type": "TOKEN_F1",
  "status": "COMPLETED",
  "score": 0.82,
  "passed": true,
  "implementationVersion": "a1.0",
  "minPassingScore": 0.5
}
```

Errors use `status: "ERROR"` or `"INVALID_CONFIG"` with `errorCode` (not scored,
case outcome `ERROR`).

## Scoring integration

- Pass rate: unchanged (`PASS` count / total cases).
- Quality score: mean of persisted `evaluatorResults.score` when finite in `[0,1]`; legacy rows without `score` fall back to binary PASS/FAIL mapping.

## Limits

- Reference / run output text: 100,000 characters
- Concepts: max 64, each max 500 characters
- ROUGE-L: combined token count ≤ 8,192

## Deferred (A2+)

LLM judges, semantic similarity, RAG metrics, regex, JSON Schema, multi-evaluator weighting, async evaluator jobs.