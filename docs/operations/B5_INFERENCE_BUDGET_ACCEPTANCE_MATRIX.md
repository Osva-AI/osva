# B5 — Inference Budget Acceptance Matrix (B5.0R)

**Status:** Design acceptance (tests to be implemented in B5.3+). B5.0R final corrections applied.

**Architecture:** `docs/implementation/B5_INFERENCE_BUDGET_ARCHITECTURE.md`
**ADR:** `docs/adr/ADR-013-workspace-inference-budget-authority.md`
**Verification gate:** `docs/engineering/OSVA_VERIFICATION_STRATEGY.md` at slice completion.

---

## Harness conventions (future)

- Worker integration: fake provider servers (same pattern as `inference-routing.integration.test.ts`).
- PostgreSQL: `@osva/db` Docker harness; migration `0044+`.
- Budget policy default **off**; explicit workspace activation in setup.
- Micro-USD integers: `$1.00 = 1_000_000` micros, `$0.60 = 600_000` micros.

---

## Acceptance scenarios

| ID | Scenario | Setup | Expected outcome |
| --- | --- | --- | --- |
| **B5-A1** | Budget disabled | No activation row | Identical to pre-B5 behavior; zero reservation rows; provider calls unchanged |
| **B5-A2** | Period concurrent admission (corrected) | Limit `1_000_000` micros; two parallel worker admits each ceiling `600_000` before provider | Exactly **one** admit succeeds; second fails `MODEL_INFERENCE_BUDGET_EXCEEDED`; **zero** provider HTTP on failed admit; period `reserved + committed ≤ limit` |
| **B5-A3** | Concurrent two-worker admission | Same as A2 with two `ExecuteRunAttempt` workers same workspace | Same as A2; `FOR UPDATE` serializes; no double reserve |
| **B5-A4** | Repeated reservation key | Same `reservation_key` twice (simulate DB retry or duplicate admit call) | Single row; second call idempotent; held capacity not doubled |
| **B5-A4b** | Worker replay, same logical invocation | Same `invocation_anchor`; new `RunStepId` on replay | Same `InferenceInvocationId`; `admitOrGetExisting` → **no double-reserve**; provider call count per fencing rules, not assumed exactly-once |
| **B5-A4c** | New logical invocation | Increment `modelInvocationOrdinal` or new `RunAttemptId` | New `InferenceInvocationId`; new reservation hold |
| **B5-A5** | OSVA exact-response cache hit | Cache enabled; warm key | No Budget admit; no provider; period unchanged |
| **B5-A6** | Provider prompt-cache hit | Provider returns `cachedInputTokens > 0` | Budget admit → provider → commit with priced cache tiers |
| **B5-A7** | Routing fallback pricing | Two candidates; first fails retryable; second succeeds; different pricing | Two reservation keys (`providerAttemptIndex` 0 and 1); period reflects **both** commits when usage present |
| **B5-A8** | Streaming admission | Routed stream | Admit at stream open; terminal usage reconciles; cancel mid-stream with partial usage → `RECONCILIATION_REQUIRED`, not RELEASE |
| **B5-A9** | Failure after provider acceptance | Provider returns 200 then connection drops before usage parsed | Reservation `RECONCILIATION_REQUIRED`; uncertain liability on period; **not** committed as 0 |
| **B5-A10** | Active lease vs stale reservation | RunAttempt lease lost while reservation `PROVIDER_STARTED` | Reservation not RELEASED as zero; sweeper moves to EXPIRED or RECONCILIATION_REQUIRED per policy; reconcile via RunStep/provider id |
| **B5-A11** | Provider usage exceeds reservation ceiling | `committedUsdMicros > reservedUsdMicros` | `COMMITTED` allowed; period `overage_usd_micros` incremented; optional alert |
| **B5-A12** | Unknown actual cost | `usageIncomplete` or null pricing after provider | `RECONCILIATION_REQUIRED`; period uncertain floor; **never** `committedUsdMicros = 0` auto |
| **B5-A13** | Evaluation judge path | Judge task with budget enabled | Admit on judge `ModelGateway` stack; workspace period updated; no routing/cache |
| **B5-A14** | Batch admit before provider submission | Item entering `SUBMITTING` / provider payload build | **Admit required before provider batch API**; denied → item fails without submit; no bypass at reconcile-only |
| **B5-A15** | Cross-workspace isolation | Workspace A at limit; workspace B has headroom | B admits and invokes; A denied; no shared period row |
| **B5-A16** | UTC period boundary | Admit `23:59:59Z` Jan 31 and `00:00:00Z` Feb 1 | Distinct `periodKey`; limits independent |
| **B5-A17** | Fail closed on ledger error | Simulate DB error on admit | No provider HTTP; run/judge fails budget error |
| **B5-A18** | Routing soft preflight + hard period | `maxEstimatedCostUsdMicros` + period cap | Both must pass; soft alone does not imply period safety |
| **B5-A19** | RunStep finalization failure | Force `finalizeSafely` / DB error on RunStep | Reservation remains `PROVIDER_STARTED` or `RECONCILIATION_REQUIRED`; held/uncertain capacity retained; reconciliation tick clears |
| **B5-A20** | Routing budget denial, no fallback | Period exhausted on first candidate with `allowFallback: true` | `MODEL_INFERENCE_BUDGET_EXCEEDED`; **zero** provider HTTP; **no** second model attempted |
| **B5-A21** | Unknown charge consumes capacity | Provider accept, unknown usage | `RECONCILIATION_REQUIRED`; `unresolved_uncertain_liability_usd_micros` incremented; available capacity reduced |
| **B5-A22** | Charge above reservation (overage) | `committed_usd_micros > reserved_usd_micros` | Full committed recorded; `overage_usd_micros` incremented; committed **not** truncated to reserve |
| **B5-A23** | Stale uncertain acceptance | `PROVIDER_STARTED` / uncertain with provider request id after lease loss | **Not** auto-refunded to available; remains until reconcile or operator resolve |
| **B5-A24** | Judge bypass prevention | Budget enabled; judge task runs | Admit on judge stack; deny blocks judge HTTP; worker misconfig without wrap → startup fail (B5.5) |
| **B5-A25** | Batch bypass prevention | Budget enabled; batch submit | Admit before provider submit; reconcile-only path cannot spend |
| **B5-A26** | Late reconciliation period snapshot | Admit in January; reconcile in February | Charge applies to January `period_key` and `budget_policy_version_id` on reservation row |

---

## Focused verification matrix (implementation)

| Slice | Command (targeted) | Scenarios |
| --- | --- | --- |
| B5.1 contracts/domain | `pnpm --filter @osva/domain exec vitest run test/inference-budget` | State machine unit |
| B5.2 db | `pnpm --filter @osva/db run test:integration -t 0044` | Period rollover, FOR UPDATE |
| B5.3 gateway + worker | `pnpm --filter @osva/worker run test:integration -- test/integration/inference-budget.integration.test.ts` | A2–A7, A17 |
| B5.4 reconcile | budget reconciliation tick + db tests | A9–A12, A19, A21–A23, A26 |
| B5.5 judge | worker judge integration subset | A13, A24 |
| B5.6 batch | `batch-inference-openai.integration.test.ts` extended | A14, A25 |
| B5.3 replay | worker inference-budget integration | A4b–A4c, A20, A22 |
| B5.x regression | routing + cache suites, budget **off** | A1, no regression |

Do not run full `verify:ci:clean` until B5 slice owner requests integration checkpoint.

### B5.5C.3 — Controlled activation (ACT1–ACT21)

| ID | Scenario | Evidence |
| --- | --- | --- |
| ACT1–ACT2 | Gate off: mutations **403**; policy CRUD/read OK | `apps/web/test/integration/inference-budget-activation.integration.test.ts` |
| ACT3–ACT10 | Activate/disable/auth/idempotency/concurrency/audit | Same |
| ACT11 | Audit failure rolls back activation | `packages/db/test/integration/inference-budget-activation-audit.integration.test.ts` |
| ACT12–ACT16 | Worker sees API activation without restart; disable preserves ledger | `apps/worker/test/integration/inference-budget-activation-c553.integration.test.ts` |
| ACT17 | In-flight reservation attribution on version switch | `apps/worker/test/integration/inference-budget-act17.integration.test.ts` (B5.6A) |
| ACT18–ACT20 | Console ADMIN/VIEWER/gate UI | `apps/console/test/inference-budget-console.test.tsx` |
| ACT21 | Unsupported runtime cannot bypass enforcement | B5.6A/B5.6B runtime matrix (declarative, REMOTE_HTTP, container K-series) |

### B5.6A — Runtime enforcement matrix (ACT17 + ACT21)

| Runtime | Enabled, admitted | Enabled, denied | Missing enforcement dep. | Dynamic activation | Budget disabled |
| --- | --- | --- | --- | --- | --- |
| Trusted TypeScript | PASS (prior `inference-budget*.integration`) | PASS | FAIL_CLOSED (worker stack) | PASS (C.3 worker test) | PASS |
| Declarative | PASS — `inference-budget-declarative-b56a` D1 | PASS — D2 | PASS — `declarative-runtime-adapter` D3 unit | PASS — D4 | PASS — D5 |
| REMOTE_HTTP | PASS — `inference-budget-remote-http-b56a` H1/H2 | PASS — H3 | PASS — H4 (no capability secret) | PASS — `inference-budget-remote-http-h6` (B5.6B) | PASS — H7 |
| Container | PASS — K1/K2/K8 | PASS — K3 | PASS — K4/K6 (missing bridge / missing creds) | PASS — K8 | PASS — K7 |

### B5.6B — Container K-series (worker E2E, Docker)

**Fresh run (2026-11-21):** `10/10` tests **PASS** in `inference-budget-container-b56b.integration.test.ts`.

| ID | Scenario | Result |
| --- | --- | --- |
| K1 | Enabled budget + sufficient capacity → model succeeds | **PASS** |
| K2 | Admission + `PROVIDER_STARTED` before provider HTTP (`gpt-budget-slow`) | **PASS** |
| K3 | Insufficient budget → zero provider HTTP | **PASS** |
| K4 | Missing capability bridge → zero provider HTTP | **PASS** |
| K5 | Untrusted workspace/policy fields in run input ignored | **PASS** |
| K6 | Capability present, worker provider creds absent → zero provider HTTP | **PASS** |
| K7 | Budget disabled → echo unchanged | **PASS** |
| K8 | Post-startup activation enforced without worker restart | **PASS** |
| K9 | Streaming via container capability | **UNSUPPORTED** (Protocol V1: `generate-text` only) |
| K10 | Provider failure after start; liability retained | **PASS** |

**NOT VERIFIED:** Invalid capability **bearer token** E2E on container (token issuance is worker-side; negative bearer covered in bridge/unit tests, not forged from example image).

Harness: `apps/worker/test/integration/inference-budget-container-b56b.integration.test.ts`. Production fixes: `container-capability-url.ts`, `capability-bridge.ts` ownership, harness `OPENAI_API_KEY`.

**Release stance:** Container **generate-text** under budget is **supported** locally through K1–K8 and K10. **Streaming (K9) is unsupported** on Protocol V1.

**B5.6A commands (targeted):**

```bash
pnpm --filter @osva/adapters-runtime-declarative exec vitest run test/declarative-runtime-adapter.test.ts -t "D3"
pnpm --filter @osva/worker run test:integration -- test/integration/inference-budget-act17.integration.test.ts
pnpm --filter @osva/worker run test:integration -- test/integration/inference-budget-declarative-b56a.integration.test.ts
pnpm --filter @osva/worker run test:integration -- test/integration/inference-budget-remote-http-b56a.integration.test.ts
pnpm --filter @osva/worker run test:integration -- test/integration/inference-budget-remote-http-h6.integration.test.ts
pnpm --filter @osva/worker run test:integration -- test/integration/inference-budget-container-b56b.integration.test.ts
```

**Operator:** `OSVA_INFERENCE_BUDGET_ACTIVATION_ENABLED` defaults **false** on `apps/web` (`config.ts`). Enabling in production is a deliberate operator action; worker enforcement of an already-active row is **not** disabled when the gate is off.

---

## Evidence ledger (B5.0R design only)

| Check | Result |
| --- | --- |
| Stack composition verified | `apps/worker/src/process.ts`, `run-step-recorder.ts` |
| `onProviderAttempt` post-invoke verified | `routing-model-gateway.ts:356–422` |
| RunStepId UUID at step start (not budget anchor) | `run-step-recorder.ts:222, 392, 579` |
| Durable anchor pattern reference | `run-operation-journal.ts` unique `(run_id, operation_key)` |
| Judge bypasses routing/recorder today | `evaluation-judge-model-invoker.ts`, `process.ts:682` — **B5.5 must wrap** |
| OSVA cache before provider | `caching-model-gateway.ts:116–124` |
| Automated B5 tests executed in B5.0R | **Not run** (by instruction) |

---

## Git safety

B5.0R produces documentation only. Human operator owns all Git/GitHub writes.