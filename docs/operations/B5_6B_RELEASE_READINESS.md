# B5 — Inference budget release candidate (RC) readiness

**Branch:** `feat/b5-inference-governance` (local verification; human owns Git/GitHub)
**Migrations:** `0044_inference_budget_slice`, `0045_inference_budget_recovery`
**Handoff date:** 2026-11-21 (B5 RC documentation)

---

## Release recommendation: **RC for human review** (hosted gates pending)

B5 inference budget implementation is **complete for release review**. Ship when **hosted CI**, **`verify:ci:clean`**, **migration integrity**, and **production docker smoke** are green on the operator’s timeline.

**Activation gate:** `OSVA_INFERENCE_BUDGET_ACTIVATION_ENABLED` defaults **OFF** on web. Worker enforcement of an already-active workspace row is **independent** of the gate.

**Product semantics:** Period limits use **estimates** (micro-USD), not invoices. **Actual provider spending may exceed admitted ceilings** (overage and uncertain liability are explicit; see ADR-013 / architecture doc).

---

## Runtime support (billable enforcement)

| Runtime family | Budget enabled stance | Local acceptance |
| --- | --- | --- |
| Trusted TypeScript | **Supported** | Worker integration suites (B5.3+) |
| Declarative | **Supported** | `inference-budget-declarative-b56a` **PASS** |
| REMOTE_HTTP | **Supported** | `inference-budget-remote-http-b56a` **PASS**; H6 dynamic activation **PASS** |
| Container | **Supported** (Protocol V1 **generate-text** only) | K-series **10/10 PASS** (local Docker); K9 streaming **UNSUPPORTED** |

**Container note:** Runtime Protocol V1 exposes `generate-text` only (no streaming capability path). Operators on bridge networking must ensure container-reachable capability URLs (`host.docker.internal` on Docker Desktop when the worker binds loopback).

---

## Acceptance evidence (fresh vs pending)

| Area | Evidence | Result |
| --- | --- | --- |
| ACT17 | `inference-budget-act17.integration.test.ts` | **PASS** (prior B5.6A/B sessions) |
| Trusted TypeScript | `inference-budget.integration.test.ts` | **PASS** (prior slices) |
| Declarative B5.6A | `inference-budget-declarative-b56a` | **PASS** |
| REMOTE_HTTP B5.6A | `inference-budget-remote-http-b56a` | **PASS** |
| REMOTE_HTTP H6 | `inference-budget-remote-http-h6` | **PASS** |
| Container K1–K10 | `inference-budget-container-b56b` | **10/10 PASS** (2026-11-21 fresh Docker) |
| DB migrations | `inference-budget*.integration` (db package) | **PASS** (29 cases; prior session — **not re-run** at RC handoff) |
| Prettier (branch changed set) | `prettierSupportedChangedFiles()` | **150/150 PASS** |
| `verify:ci:clean` | `pnpm verify:ci:clean` | **PENDING** — prior local attempts did not complete green; **do not mark PASS** |
| Hosted CI | GitHub PR checks | **PENDING** (human) |
| `pnpm db:migrations:integrity` | with `OSVA_DATABASE_URL` | **PENDING** (human) |
| Docker production smoke | `scripts/deployment/docker-image-smoke.mjs` | **PENDING** (human) |

---

## Container K-series (final)

Harness: `apps/worker/test/integration/inference-budget-container-b56b.integration.test.ts`

| ID | Result | Notes |
| --- | --- | --- |
| K1 | **PASS** | Admitted model run, one fake provider HTTP, `SUCCEEDED` |
| K2 | **PASS** | `gpt-budget-slow`; reservation before provider; `PROVIDER_STARTED` at first HTTP |
| K3 | **PASS** | Deny; zero provider HTTP |
| K4 | **PASS** | Missing capability bridge; zero provider HTTP |
| K5 | **PASS** | Untrusted input fields do not forge workspace |
| K6 | **PASS** | No worker credentials → zero provider HTTP |
| K7 | **PASS** | Budget disabled echo |
| K8 | **PASS** | Post-startup REST activation without worker restart |
| K9 | **UNSUPPORTED** | No streaming routes in `RUNTIME_CAPABILITY_PATHS` |
| K10 | **PASS** | Provider failure after start; no blanket `RELEASED`; one provider HTTP |

**Coverage gap:** **Invalid capability bearer token** on an in-flight container run — **NOT VERIFIED** E2E (example image cannot forge tokens; bridge rejection covered elsewhere).

---

## Production fixes (container path)

| Issue | Fix |
| --- | --- |
| Bridge-unreachable capability URL | `resolveContainerCapabilityBaseUrl` (`container-capability-url.ts`) |
| Provider-start generation fence | `executionOwnership` on capability `authorize()` (`capability-bridge.ts`) |
| Harness `credentialRef` | Worker env `OPENAI_API_KEY=test-key` in container integration harness |

---

## Deployment validation

| Requirement | Status |
| --- | --- |
| Default `OSVA_INFERENCE_BUDGET_ACTIVATION_ENABLED=false` | `apps/web/src/config.ts` |
| Compose / Helm document gate default false | `deploy/compose`, `deploy/helm/osva` |
| Worker budget enforcement independent of gate | Architecture + worker tests |

---

## Known limitations (RC)

- Container **streaming** under budget: **UNSUPPORTED** (Protocol V1).
- Invalid bearer E2E on container: **NOT VERIFIED**.
- Hosted CI, clean verification, migration integrity CLI, production image smoke: **operator pending**.
- Provider invoices may diverge from OSVA estimates (overage / uncertain liability by design).

---

## Human-only checklist

- [ ] Review full branch diff (`feat/b5-inference-governance`)
- [ ] Run `pnpm verify:ci:clean` once on a clean tree (or rely on hosted CI)
- [ ] Run `pnpm db:migrations:integrity` against staging-like Postgres
- [ ] Run `scripts/deployment/docker-image-smoke.mjs` (optional RC gate)
- [ ] Confirm hosted CI green on PR
- [ ] Commit, push, merge (human only)
- [ ] Staging: migrate **0044/0045**, smoke web + worker + postgres + valkey
- [ ] Keep activation gate **false** until deliberate operator enable

---

## Key doc links

- [`B5_INFERENCE_BUDGET_ACCEPTANCE_MATRIX.md`](B5_INFERENCE_BUDGET_ACCEPTANCE_MATRIX.md)
- [`B5_INFERENCE_BUDGET_OPERATOR_RUNBOOK.md`](B5_INFERENCE_BUDGET_OPERATOR_RUNBOOK.md)
- [`../implementation/B5_INFERENCE_BUDGET_ARCHITECTURE.md`](../implementation/B5_INFERENCE_BUDGET_ARCHITECTURE.md)
- ADR-013 workspace inference budget authority