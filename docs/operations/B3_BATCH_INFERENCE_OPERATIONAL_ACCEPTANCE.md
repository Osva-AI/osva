# B3 — Native batch inference operational acceptance

Branch: `feat/aio-inference-optimization`

## Supported native modes

| Provider | Mode | Evidence |
| --- | --- | --- |
| OpenAI | JSONL batch API | Worker integration + fake server |
| Anthropic | Message Batches | Worker integration + unit adapter tests |
| Gemini | Inline batch | Worker integration + unit adapter tests |

## Workspace policy

- Default **off** (`workspace_batch_inference_policies`). Enable via repository `upsertPolicy` (no public enable HTTP in this slice).
- `allowedProviders`, `maxItemCount`, and `denySensitiveWorkloads` enforced at create.

## Worker reconciliation

- Recovery tick runs `BatchInferenceRecoveryCoordinator` (same pattern as execution recovery).
- Jobs poll via `reconcileAfterAt`; bounded backoff on provider poll/result failures (15s).
- Submission fenced with `submission_lease_owner` + conditional `markSubmitted` (no `provider_batch_id` overwrite).

## Ambiguous submission

- Provider accept + lost local ack → `reconciliationRequired` on `SUBMITTING` without `providerBatchId`.
- Workers **do not** auto-resubmit. Operator must record recovered `provider_batch_id` (B3.3+ operational procedure).

## Correlation safety

- Duplicate or unexpected provider correlation ids → `reconciliationRequired` + metric `osva.batch.correlation_anomalies`.
- Unknown ids are **not** mapped to local items.

## Cancellation

- REST cancel → `CANCELLING`; worker calls provider cancel when supported.
- Provider `cancelled` with partial output → `PARTIALLY_COMPLETED` when items succeeded/failed; not treated as full success.

## Pricing

- Immutable `pricing_snapshot_json` + `request_material_hash` at create (migration `0042`).
- Per-item `estimated_cost_micros`; job aggregate at terminal. Estimated only, not invoiced.
- `usage_finalized_at` prevents double finalization.

## Metrics (OpenTelemetry)

Counters: `osva.batch.submission_*`, `osva.batch.reconciliation_*`, `osva.batch.job_terminal`, `osva.batch.item_terminal`, `osva.batch.correlation_anomalies`, `osva.batch.cancellations`.

Labels: `provider`, `outcome`, `status` only (no workspace/job/item ids).

## Retention

- Item results stored in PostgreSQL JSON within schema payload limits; large provider files are not exposed via public URLs.
- Provider file cleanup is operator responsibility; OSVA retains workspace-scoped job/item rows per workspace lifecycle.

## Restart procedure

1. Stop worker safely (`worker.shutdown_complete`).
2. Start worker; due jobs with persisted `provider_batch_id` resume poll/reconcile automatically.

## Known limitations

- No provider-side idempotency lookup for ambiguous submissions.
- Gemini file-backed batch modes not fully acceptance-tested.
- Branch-wide `verify:ci:clean` deferred to B0–B4 PR readiness.

## Integration evidence

`apps/worker/test/integration/batch-inference-openai.integration.test.ts` — lifecycle, policy, idempotency, ambiguous submit, reconcile idempotency, cancel, Anthropic/Gemini E2E, mixed failure, poll recovery, worker restart, dual-worker race, correlation quarantine, policy repo.