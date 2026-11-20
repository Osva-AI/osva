# B5 — Workspace inference budget operator runbook

**Scope:** Production operation of workspace-scoped inference budgets (ADR-013).  
**Related:** `docs/implementation/B5_INFERENCE_BUDGET_ARCHITECTURE.md`, `docs/operations/B5_INFERENCE_BUDGET_ACCEPTANCE_MATRIX.md`

---

## A. Prerequisites

| Requirement | Notes |
| --- | --- |
| PostgreSQL migrations **0044** and **0045** applied | Fresh installs and upgrades from **0043** head |
| Worker and web on current B5 build | Budget enforcement is worker-side; activation mutations are web-side |
| Model profile **pricing** configured | Admission uses pricing snapshots; missing pricing → fail-closed / reconciliation paths |
| **Inference routing** activated when using routed agent paths | Budget pairs with `BudgetEnforcingModelGateway` under routing |
| Supported runtimes for billable enforcement | **Trusted TypeScript**, **Declarative**, **REMOTE_HTTP**, **Container** (generate-text only; B5.6B K-series 10/10 local). Set `OSVA_CONTAINER_CAPABILITY_BASE_URL` when the worker capability listen address is not reachable from bridge containers |

### Feature gate (HTTP mutations only)

- `OSVA_INFERENCE_BUDGET_ACTIVATION_ENABLED` on **web** defaults **false** (unset → false).
- When **false**: policy CRUD, configuration, usage, and activation **read** APIs work; **POST** `/activate` and `/disable` return **403**.
- **Worker enforcement is independent:** an already-active `workspace_inference_budget_activation` row remains enforced even when the gate is off.

---

## B. Activation

1. Apply migrations and deploy web + worker.
2. Create or select an **immutable** policy version (`append` only; no in-place edits).
3. **Explicitly** set `OSVA_INFERENCE_BUDGET_ACTIVATION_ENABLED=true` on the **web** deployment (Compose comment, Helm `web.inferenceBudgetActivationEnabled`, or env).
4. As **ADMIN**, `POST /v1/workspace-inference-budget/activate` with `{ "policyVersionId": "..." }`.
5. Confirm **security audit** event `WORKSPACE_INFERENCE_BUDGET_ACTIVATION_CHANGED`.
6. Confirm worker admission on a test run (reservation row, `PROVIDER_STARTED` before provider HTTP).

Activate **pinning:** activation references one policy version id; in-flight reservations keep their original version attribution.

---

## C. Monitoring

Use control-plane usage/configuration endpoints and PostgreSQL authority tables:

| Signal | Meaning |
| --- | --- |
| `committed_liability_usd_micros` | Settled estimate for the UTC period |
| Held reservations (`PROVIDER_STARTED`, etc.) | Outstanding capacity / uncertain paths |
| `overage_usd_micros` | Committed above reserved ceiling (allowed) |
| `unresolved_uncertain_liability_usd_micros` | Unknown-cost floor |
| Reconciliation / recovery tick logs | Stale holds, `RECONCILIATION_REQUIRED` |
| `MODEL_INFERENCE_BUDGET_EXCEEDED` on runs | Period denial (zero provider on deny paths) |

---

## D. Recovery

| Situation | Operator action |
| --- | --- |
| Disable workspace enforcement | Gate **on** → ADMIN `POST .../disable` (audit event). Does **not** refund in-flight reservations. |
| In-flight provider call | Wait for completion or reconciliation; do not assume disable erases liability |
| Lease loss / worker crash | Recovery tick; reservations may enter `RECONCILIATION_REQUIRED` |
| Unknown provider outcome | Reconciliation; period uncertain liability increases |
| Transient DB errors on admit | Fail-closed: no provider HTTP |

---

## E. Rollback

- Set activation gate **false** to block new activate/disable API calls (does **not** deactivate DB row).
- To stop new admissions: disable workspace policy via API (when gate allows) or disable activation row through supported admin flow.
- **No automatic refund** of committed or uncertain micros for the period.
- Period bucket and **budget_policy_version_id** on reservations are **not reset** on version switch or disable.

---

## F. Limitations

- Estimates are **not** provider invoices. **Actual provider spend may exceed admitted reservation ceilings** (`overage_usd_micros`, uncertain liability, reconciliation paths).
- **Container + budget:** Local acceptance **K1–K8, K10 PASS**; **K9 streaming UNSUPPORTED** (Runtime Protocol V1 has no streaming capability route). Invalid capability bearer on a running container — **NOT VERIFIED** E2E.
- Ensure container-reachable capability URL on bridge networks (`host.docker.internal` on Docker Desktop when the worker binds loopback).
- **Batch / judge** paths have dedicated acceptance suites; misconfigured worker (policy on without wrap) must fail startup in production configs.
- **Hosted CI**, `verify:ci:clean`, `db:migrations:integrity`, and production docker smoke are **release gates for humans** — not auto-passed by local slice work alone.

---

## Re-enabling the mutation gate after it was off

1. Set `OSVA_INFERENCE_BUDGET_ACTIVATION_ENABLED=true` on **web** and restart web.
2. Existing active workspace rows **continue** enforcing on workers (unchanged).
3. Use activate/disable APIs only after gate is true.