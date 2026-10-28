# M15 Acceptance Summary — Production Adoption & Operational Experience

Status: **ACCEPTED (scoped)** — in-repository adoption evidence reconciled; external distribution and long-lived operator database checks remain partially deferred.

Baseline: Community **`1.1.0-rc.4`** · tag **`v1.1.0-rc.4`** → **`cd38eea46b8ee44bb099ccf307818cfcd348f50b`** · migration head **`0030_approval_operation_binding_slice`**.

Implementation: [`../implementation/M15-PRODUCTION-ADOPTION-OPERATIONAL-EXPERIENCE.md`](../implementation/M15-PRODUCTION-ADOPTION-OPERATIONAL-EXPERIENCE.md) · Closeout narrative: [`M15_CLOSEOUT_SUMMARY.md`](M15_CLOSEOUT_SUMMARY.md).

## 1. Milestone objective

Make shipped M11–M14 product and security work **adoptable by operators**: accurate upgrade/docs, Console evaluation UX gaps closed, operator diagnostics hardened, and a unified adoption acceptance replay with recorded evidence — without claiming broader production certification than tests support.

## 2. M15.1–M15.5 evidence matrix

| Slice | Scope delivered | PR / merge | Verification | Acceptance | Known limitations |
| --- | --- | --- | --- | --- | --- |
| **M15.1** | Tracker/roadmap reconciliation, UPGRADE through **0030**, RC.4 verification record, Console surface docs | PR **#59** → **`6716b83`** | Doc review; `release:version:check`; migration manifest | **PASS** (documentation) | Does not prove registry publication by itself |
| **M15.2** | Playwright quality-gate launch/detail; **PASS** / **FAIL** / **INDETERMINATE** browser copy | PR **#60** → **`c313e1e`** | `m13-7-5-browser.integration.test.ts`; included in M15.4 **full** profile | **PASS** | Fixture-backed Console paths only |
| **M15.3** | Shared operator diagnostics on Run, WorkflowRun, connector, model, knowledge surfaces | PR **#61** → **`f2a80e0`** | Console unit tests; M15.4 journey **F** | **PASS** | No live queue/worker health proof from Console |
| **M15.4** | `pnpm acceptance:m15` orchestration (profiles default/integration/browser/full) | PR **#62** → **`045122e`** | Runner unit tests; operator **full** profile evidence (below) | **PASS** (mandatory journeys) | `applied_and_matches` on long-lived DB not wired; M10.4E registry-only replay pending |
| **M15.5** | Evidence reconciliation, release/ecosystem audit, acceptance/closeout docs, roadmap | (this slice) | Focused gates + `verify:changed` on closeout commit | **PASS** (closeout) | `pnpm verify:ci:clean` not re-run locally (see §10) |

Prior security baseline unchanged: [`M14_7_SECURITY_CLOSEOUT.md`](M14_7_SECURITY_CLOSEOUT.md).

## 3. Acceptance profiles and results (M15.4)

Machine-readable evidence (operator workstation, gitignored): `artifacts/acceptance/m15-4/latest.json`.

| Profile | Command | Code revision | Finished (UTC) | Steps | PASS | FAIL | BLOCKED | NOT RUN | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **`full`** | `pnpm acceptance:m15:full` | **Not recorded in JSON** (run predates **`045122e`** merge; step catalog matches merged runner per `pnpm acceptance:m15:test` on **`045122e`**) | **2026-10-28T08:55:24Z** | **23** | **23** | **0** | **0** | **0** | `artifacts/acceptance/m15-4/latest.json` |
| **`default`** | `pnpm acceptance:m15` | Not run as isolated profile | — | — | — | — | — | — | **Inferred PASS** — all default-tagged steps passed inside **`full`** superset |
| **`integration`** | `pnpm acceptance:m15:integration` | Not run as isolated profile | — | — | — | — | — | — | **Inferred PASS** — Docker integration steps passed inside **`full`** |
| **`browser`** | `pnpm acceptance:m15:browser` | Not run as isolated profile | — | — | — | — | — | — | **Inferred PASS** — Playwright steps passed inside **`full`** |

Journey coverage (all **PASS** in **`full`** run): **A** bootstrap · **B** model/connector (M12.3) · **C** agent/worker · **D** workflow/canonical · **E** evaluation gates · **F** operator UX · **G** M14 security · **RC4** version/pack/npm `@rc` check.

**Not executed** by M15.4 orchestration (documented deferrals): schema **`applied_and_matches`** against a production `OSVA_DATABASE_URL`; M9.7B B3/B4; M10.4E published-registry-only Compose replay; Kind/Helm via `release:acceptance` unless operator opts in.

## 4. Deployment and upgrade verification

| Check | Result | Evidence |
| --- | --- | --- |
| Migration journal head **0030** | **PASS** | `pnpm db:migrations:verify` (M15.5 + M15.4 **full**) |
| Forward-only upgrade documentation | **PASS** | [`UPGRADE.md`](UPGRADE.md) through **0030** |
| Human identity bootstrap | **PASS** (documented + harness) | M15.4 human-session integration; [`UPGRADE.md`](UPGRADE.md) M11 section |
| Compose config validation | **PASS** | M15.4 `deploy-compose-config.test.mjs` |
| Hello Agent onboarding inventory | **PASS** | M15.4 `hello-agent-onboarding.test.mjs` |
| Helm chart version alignment | **PASS** | `deploy/helm/osva/Chart.yaml` **1.1.0-rc.4**; `release:version:check` |
| Operator backup/recovery docs | **PASS** (documentation) | [`BACKUP_AND_RECOVERY.md`](BACKUP_AND_RECOVERY.md) |
| Long-lived DB integrity probe | **NOT RUN** | Requires operator `OSVA_DATABASE_URL` + `pnpm db:migrations:integrity` |

## 5. Security regression evidence

M14 controls remain documented in [`M14_7_SECURITY_CLOSEOUT.md`](M14_7_SECURITY_CLOSEOUT.md). M15.4 **full** profile re-ran:

- `@osva/adversarial-acceptance` (M14.4)
- M14.2 human-session HTTP + workspace isolation matrix
- PostgreSQL approval operation binding (**0030**) integration tests

**Residual (unchanged):** workflow-level approval binds **workflow node operation digests**, not arbitrary tool-call arguments; **no tool-call-level approval** product primitive. Workflow approval does **not** authorize all tool execution globally.

## 6. External ecosystem compatibility

| Repository | Source compatibility | Published package pins | Packaged/live acceptance | Notes |
| --- | --- | --- | --- | --- |
| **Osva-AI/osva** (this repo) | **`1.1.0-rc.4`** @ **`045122e`** | Five npm **`@rc`** → **1.1.0-rc.4** (verified M15.5) | M15.4 **full** (source/workspace harness) | Canonical adoption example in-repo |
| **Osva-AI/osva-adapters** | Declares **`@osva-ai/contracts@1.1.0-rc.4`** | Adapter npm **0.1.x** published; sidecar **not** on npm | A1.x acceptance scripts vs packed contracts | GHCR **1.1.0-rc.4** image **not** published — A1.4 may build locally |
| **Osva-AI/osva-connectors** | Connector SDK workspace packages | Per-connector npm (separate release line) | ToolGateway CI pin in osva `.github/workflows/github-connector-integration.yml` | Pin may trail `main`; live cloud providers excluded from M15.4 |
| **Osva-AI/osva-examples** | Examples repo; SDK via package deps in subpackages | Consumes published SDK when installed from registry | **NOT VERIFIED** against **`1.1.0-rc.4`** in this closeout | Follow-up: bump examples to RC.4 and run `verify` |

Follow-up (outside this repository): publish PyPI/GHCR RC.4; M10.4E-style registry-only replay; osva-examples RC.4 verification; osva-adapters tag reference commit in COMPATIBILITY should track **`cd38eea`** not stale SHAs.

## 7. Published artifact status (RC.4)

Reconciliation date: **2026-10-28** (M15.5).

| Channel | Classification | Verified fact |
| --- | --- | --- |
| Repository **`VERSION`** | **PUBLISHED** (source) | **`1.1.0-rc.4`** |
| Git tag **`v1.1.0-rc.4`** | **PUBLISHED** | → **`cd38eea46b8ee44bb099ccf307818cfcd348f50b`** |
| GitHub prerelease **`v1.1.0-rc.4`** | **PUBLISHED** | **2026-10-27T09:54:36Z** |
| npm five packages **`@rc`** | **PUBLISHED** | **`1.1.0-rc.4`** (`npm view @osva-ai/*@rc`) |
| PyPI **`osva-sdk`** | **NOT PUBLISHED** (RC.4) | Latest: **`1.1.0rc2`** (PyPI JSON index) |
| GHCR **`ghcr.io/osva-ai/osva:1.1.0-rc.4`** | **NOT PUBLISHED** | Latest tagged container: **`1.1.0-rc.2`** |
| Helm chart in repo | **NOT APPLICABLE** (registry) | **`1.1.0-rc.4`** in-tree; not a separate registry claim |
| M10.4E registry-only Compose replay | **NOT RUN** (RC.4) | RC.2 record remains in M10.4 doc |
| GitHub **Release readiness** on **`cd38eea`** | **PUBLISHED** (CI evidence) | All jobs **success** ([`RC4_VERIFICATION.md`](../release/RC4_VERIFICATION.md)) |
| GitHub **CI** on M15.4 merge **`045122e`** | **PUBLISHED** (CI evidence) | **`verify:ci`** job **success** **2026-10-28** |

## 8. Production adoption assessment (14 journeys)

Evidence type: **A** = automated fixture/harness · **D** = documentation/runbook · **M** = manual operator step not replayed in M15.4.

| # | Journey | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | Install supported distribution | **PARTIAL** | npm **`@rc`** **A**; PyPI/GHCR **D** (RC.2 pins) |
| 2 | Configure infrastructure | **PASS (scoped)** | Compose/Helm validation **A**; env inventory **A** |
| 3 | Bootstrap human identity | **PASS (scoped)** | **A** human-session + **D** [`UPGRADE.md`](UPGRADE.md) |
| 4 | Connect model provider | **PASS (scoped)** | **A** M12.3 fake model; live provider **M** |
| 5 | Register/discover MCP connector | **PASS (scoped)** | **A** M12.3 MCP fixture; live STDIO/cloud **M** |
| 6 | Bind model/tool to agent | **PASS (scoped)** | **A** M12.3 + M13.3 browser |
| 7 | Create/execute declarative agent | **PASS (scoped)** | **A** M13.3 + worker integration |
| 8 | Build/execute workflow | **PASS (scoped)** | **A** canonical + M13.6 browser |
| 9 | Approvals and event waits | **PASS (scoped)** | **A** canonical E2E + approval **0030** DB |
| 10 | Launch evaluation | **PASS (scoped)** | **A** M13.7.x + M15.2 browser |
| 11 | Interpret PASS/FAIL/INDETERMINATE gates | **PASS** | **A** M15.2 browser + domain tests |
| 12 | Inspect RunAttempts / diagnostics | **PASS (scoped)** | **A** M15.3 unit; live worker health **D** limit |
| 13 | Identify operational failures safely | **PASS (scoped)** | **A** M15.3 + M14 adversarial |
| 14 | Restart/upgrade deployments | **PASS (scoped)** | **D** UPGRADE/BACKUP; long-lived DB integrity **M** |

## 9. Known limitations

- **Distribution:** RC.4 is **npm-complete**; **PyPI**, **GHCR**, and **M10.4E** isolated consumer replay are **outstanding**.
- **Adoption proof:** M15.4 replays **source/workspace-linked** harnesses — not tarball-only installs for the full Console journey matrix.
- **Console operations:** Cannot prove worker queue health or connector reachability without a successful control-plane call.
- **Real providers:** M12.3/M15.4 use fake model + MCP fixtures; live OpenAI/Gemini/GitHub production credentials are operator-owned acceptance.
- **Production DB:** No `applied_and_matches` evidence for long-lived operator stacks in M15.4.
- **Clean gate:** `pnpm verify:ci:clean` not executed on M15.5 closeout commit (see §10).

## 10. Verification performed (M15.5)

| Command | When | Result | Cached? |
| --- | --- | --- | --- |
| `pnpm release:version:check` | M15.5 closeout | **PASS** | — |
| `pnpm db:migrations:verify` | M15.5 closeout | **PASS** | turbo cache hits |
| `pnpm acceptance:m15:test` | M15.5 closeout | **PASS** (5 tests) | — |
| `git diff --check` | M15.5 closeout | **PASS** | — |
| `pnpm verify:changed` | M15.5 closeout (after doc edits) | See closeout handoff | — |
| `pnpm acceptance:m15:full` | **2026-10-28** operator run | **PASS** (23/23) | **Cached evidence** — not re-run during M15.5 |
| `pnpm verify:ci:clean` | — | **NOT RUN** | GitHub **CI** ran **`verify:ci`** on **`045122e`** (**success**) — not equivalent to local **`verify:ci:clean`** |

## 11. Final acceptance decision

| Claim | Decision |
| --- | --- |
| M15 **implementation** complete (slices 1–5) | **YES** |
| M15 **acceptance** complete for documented adoption journeys | **YES (scoped)** — M15.4 **full** profile **PASS** + prior slice PR evidence |
| **Published distribution** complete for all RC.4 channels | **NO** — PyPI/GHCR/M10.4E gaps remain |
| **Production deployment certification** for arbitrary operators | **NO** — residual manual steps, unpublished channels, and fixture-backed proof |

**Recommendation:** Treat M15 as **closed for engineering milestone purposes** with explicit residual risks above. Next work should target **RC.4 channel completion** (PyPI/GHCR/M10.4E) and **independent tarball adoption** before claiming registry-only production readiness.
