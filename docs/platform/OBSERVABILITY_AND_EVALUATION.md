# Observability and Evaluation

## Observability (Stage 1.7)

Canonical persisted execution observability lives on **RunStep** records owned by
OSVA. Each model or tool capability call creates a RunStep with immutable
identity fields (`kind`, `bindingName`, bound version id, `startedAt`) and
terminal metadata (`status`, timing, normalized usage, estimated cost, error
code).

RunStep deliberately does **not** store model prompts/responses, tool
input/output, provider SDK objects, or queue identifiers.

Model usage is normalized provider-neutrally (`inputTokens`, `outputTokens`,
`totalTokens`, optional `cachedInputTokens`). Estimated model cost uses an
optional immutable **pricing snapshot** on `ModelProfileVersion`; missing
pricing yields explicit unpriced usage rather than zero cost.

RunAttempt usage summaries aggregate succeeded model/tool steps only. External
telemetry exporters remain non-canonical; OpenTelemetry backends are not part of
Stage 1.7.

## Evaluations (Stage 1.7)

Stage 1.7 implements one deterministic evaluator: **`JSON_EXACT_MATCH`**. It
compares the persisted successful RunAttempt output to caller-supplied expected
JSON using structural canonical equality (property order independent). No LLM
judge, datasets, or automatic evaluation runs yet.

Evaluation results are immutable after creation.

## Later stages

Future evaluation types may include schema/rules, datasets, LLM judge, and human
review. OSS 1.0 may use evaluation gates before AgentVersion activation.
