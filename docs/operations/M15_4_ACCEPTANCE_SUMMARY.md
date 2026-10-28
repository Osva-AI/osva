# M15.4 Acceptance Summary — Unified Production Adoption Acceptance

Status: **Complete** — orchestration documented; **`full`** profile **PASS** (**23/23** steps) recorded **2026-10-28** in gitignored `artifacts/acceptance/m15-4/latest.json`. Isolated **default** / **integration** / **browser** profile runs were not recorded separately; mandatory steps for those profiles passed as part of **`full`**.

Implementation tracker: [`../implementation/M15-PRODUCTION-ADOPTION-OPERATIONAL-EXPERIENCE.md`](../implementation/M15-PRODUCTION-ADOPTION-OPERATIONAL-EXPERIENCE.md).

## 1. Acceptance objective

Provide a single, maintainable entry point (`pnpm acceptance:m15`) that replays existing adoption journeys across bootstrap, model/connector, agent execution, workflow, Evaluation Studio, operator diagnostics, and M14 security regression — without copying test implementations.

## 2. Existing tests reused

| Journey | Primary reused suites |
| --- | --- |
| **A** Bootstrap | `pnpm release:version:check`, `pnpm db:migrations:verify`, `deploy-compose-config.test.mjs`, `hello-agent-onboarding.test.mjs`, `console-human-session.integration.test.ts`, M12.3/M13.4 browser |
| **B** Model & connector | `pnpm acceptance:m12-3` → `m12-3-cross-capability.integration.test.ts` |
| **C** Agent execution | M12.3 cross-capability, `pnpm --filter @osva/worker test:integration`, `m13-3-browser.integration.test.ts` |
| **D** Workflow | `pnpm canonical:test:integration`, `m13-6-browser.integration.test.ts` |
| **E** Evaluation Studio | M13.7.5 unit + HTTP tests, `m13-7-5-browser.integration.test.ts` (M15.2) |
| **F** Operator diagnostics | M15.3 Console unit tests (`operator-diagnostics`, `error-state`, run/workflow detail) |
| **G** Security | `@osva/adversarial-acceptance`, M14.2 HTTP tests, workspace isolation REST tests, `approval-requests.integration.test.ts` |
| **RC4** | `version-consistency`, `npm-pack-smoke`, optional `npm view @rc` check |

## 3. New orchestration code

| Path | Role |
| --- | --- |
| `scripts/acceptance/m15-4/run.mjs` | Profile-aware sequential runner, Docker preflight, evidence JSON |
| `scripts/acceptance/m15-4/lib/steps.mjs` | Step catalog (groups A–G + RC4) |
| `scripts/acceptance/m15-4/lib/run-step.mjs` | PASS / FAIL / BLOCKED / NOT_RUN execution |
| `scripts/acceptance/m15-4/lib/rc4-registry-check.mjs` | Optional published npm `@rc` verification |
| `scripts/acceptance/m15-4/lib/report.mjs` | Terminal matrix output |
| `scripts/acceptance/m15-4/test/runner.test.mjs` | Runner wiring tests |
| Root `package.json` | `acceptance:m15`, `:integration`, `:browser`, `:full`, `:test` |
| `scripts/verification/branch-impact.mjs` | M15.3 operator-diagnostics targeted unit tests |

No new product features or duplicated Vitest suites.

## 4. Acceptance matrix by user journey

| Journey | Existing test / command | Infrastructure | Gap |
| --- | --- | --- | --- |
| A — Install & bootstrap | `db:migrations:verify` (head **0030**), deploy-compose + hello-agent harness tests | Default: none; human-session/browser: Docker | `applied_and_matches` integrity requires live `OSVA_DATABASE_URL` (use operator stack / M9.7B / compose acceptance — not wired without DB URL) |
| B — Model & connector | `acceptance:m12-3` | Docker | Real cloud providers intentionally excluded (fake model + MCP) |
| C — Agent & Run | M12.3 + worker integration | Docker | — |
| D — Workflow | `canonical:test:integration`, M13.6 browser | Docker | Long-running; run in integration/browser profiles only |
| E — Evaluation gates | M13.7.5 browser + unit/HTTP | Browser profile: Docker + Playwright | — |
| F — Operator UX | M15.3 unit tests | None | Console cannot prove live queue/worker health (documented M15.3 limitation) |
| G — Security | M14 adversarial + HTTP + approval DB integration | DB step: Docker | Full M9.7B B3/B4 optional for ops sign-off (`pnpm acceptance:m9-7b`) |
| RC4 | Version + pack smoke; optional npm `@rc` | Registry step: network | PyPI/GHCR/M10.4E published replay still **Pending** per [`RC4_VERIFICATION.md`](../release/RC4_VERIFICATION.md) |

## 5. Commands

```powershell
# Fast default adoption (no Docker)
pnpm acceptance:m15

# Docker-backed integration replay
pnpm acceptance:m15:integration

# Console Playwright adoption journeys
pnpm acceptance:m15:browser

# Maintainer sign-off (sequential superset + optional npm @rc check)
pnpm acceptance:m15:full

# Focus one journey group
pnpm acceptance:m15 -- --group=security
pnpm acceptance:m15 -- --profile=integration --group=workflow

# List steps for a profile
pnpm acceptance:m15 -- --list
pnpm acceptance:m15 -- --profile=browser --list

# Runner unit tests
pnpm acceptance:m15:test
```

Evidence artifact (gitignored): `artifacts/acceptance/m15-4/latest.json`.

Related existing commands (not replaced):

- `pnpm release:acceptance` — release packaging + compose deploy acceptance
- `pnpm acceptance:m12-3` / `:browser-ci` — M12.3 slice entry points
- `pnpm acceptance:m9-7b` — disposable stack durability/security/deployment scenarios
- `pnpm verify:branch -- --profile=integration` — merge-base branch obligations

## 6. Infrastructure prerequisites

| Profile | Docker | Playwright | Notes |
| --- | --- | --- | --- |
| `default` | No | No | Static/unit/HTTP adversarial |
| `integration` | Yes | No | Ephemeral PG/Valkey via Vitest harnesses |
| `browser` | Yes | Chromium | Builds `@osva/console`, `@osva/web`, `@osva/worker` before UI suites |
| `full` | Yes | If browser steps included | Runs all steps with `full` profile tag sequentially |

Diagnostics when Docker is missing: runner marks Docker steps **BLOCKED** (exit code **2**), not PASS. Run `pnpm verify:docker`.

## 7. PASS / FAIL / NOT RUN evidence

| Check class | How recorded |
| --- | --- |
| **PASS** | Step exit code 0 |
| **FAIL** | Step exit code non-zero (except registry NOT_RUN) |
| **BLOCKED** | Docker required but engine unavailable |
| **NOT RUN** | Optional registry check exit 3; profile omitted step |

**NOT RUN is never reported as PASS.**

Update the table below after each operator/CI profile run:

| Profile | Last run (UTC) | Verdict | Notes |
| --- | --- | --- | --- |
| `default` | — | **PASS (inferred)** | Subset of **`full`** run; not invoked alone |
| `integration` | — | **PASS (inferred)** | Docker steps in **`full`** run |
| `browser` | — | **PASS (inferred)** | Playwright steps in **`full`** run |
| `full` | **2026-10-28T08:55:24Z** | **PASS** | **23** steps, **0** fail/blocked/not-run; evidence `artifacts/acceptance/m15-4/latest.json`; git SHA **not** in artifact (predates **`045122e`** merge; catalog verified on **`045122e`** via `pnpm acceptance:m15:test`) |

## 8. Compatibility limitations

- Workspace-linked examples and Console integration tests prove **source** adoption, not isolated published tarballs (M10.4E-style replay still pending for RC.4 per RC4 doc).
- PyPI **`1.1.0rc4`** and GHCR **`1.1.0-rc.4`** publication gaps remain documented in [`RC4_VERIFICATION.md`](../release/RC4_VERIFICATION.md).
- `pnpm acceptance:m15` does **not** replace `pnpm verify:ci:clean` or GitHub Release Readiness.

## 9. Known deferred checks

- Schema **`applied_and_matches`** against a long-lived operator database (`pnpm db:migrations:integrity` with `OSVA_DATABASE_URL`).
- M10.4E published-registry-only Compose replay for RC.4.
- Optional M9.7B groups B3/B4 full stack scenarios (use `pnpm acceptance:m9-7b --group=b3` when ops need deployment-grade evidence).
- Kind/Helm acceptance (`OSVA_KIND_ACCEPTANCE=true` via `release:acceptance`).

## 10. M15.5 closeout (completed)

- [`M15_ACCEPTANCE_SUMMARY.md`](M15_ACCEPTANCE_SUMMARY.md) reconciles **`full`** profile evidence and residual gaps.
- PyPI/GHCR/M10.4E documented as **pending** in release inventory and RC.4 verification.
- `pnpm verify:ci:clean` **not** re-run for M15.5; GitHub **CI** **`verify:ci`** **success** on M15.4 merge **`045122e`**.
