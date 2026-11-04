# M18 Acceptance Summary — Console UX V2 (design foundation through resources)

Status: **ACCEPTED (feature-complete, scoped verification exceptions)** — all M18 product slices merged to **`main`**; evidence-backed test matrix below. **Do not** treat a full local **`pnpm verify:branch -- --profile=integration`** combined run as **PASS** for the V2.7 closeout slice (see §6).

**Platform baseline (unchanged by M18):** OSVA **`1.1.1`** · npm `@osva-ai/*` **`1.1.4`** · migration head **`0030_approval_operation_binding_slice`**.

**Merge baseline:** **`main`** @ **`b3c20e3`** (`feat(console): complete UX V2.7 resources and testing experience (#91)`).

Implementation narrative: slice acceptance records **M18.1–M18.5** · UX **V2.1–V2.7** merged PRs **#85–#91**.

---

## 1. Milestone objective

Deliver a cohesive **Console product UX V2** experience: global shell, adaptive home, outcome discovery, guided onboarding, Agent Studio refinement, Agent/Workflow studios, unified activity and execution surfaces, and **Resources** (models, integrations, knowledge, memory, testing) — **without** backend, database, runtime, or public API contract changes.

---

## 2. Delivered slices and PR evidence

| Slice | Scope | PR | Merge commit | Primary acceptance evidence |
| --- | --- | ---: | --- | --- |
| **M18.1** | Design foundation — shell, tokens, shared UI | **#80** | **`028aad3`** | [`M18_1_ACCEPTANCE_SUMMARY.md`](M18_1_ACCEPTANCE_SUMMARY.md) · `m18-1a/1b-browser.integration.test.ts` |
| **M18.2** | Adaptive Home | **#81** | **`128035d`** | [`M18_2_ACCEPTANCE_SUMMARY.md`](M18_2_ACCEPTANCE_SUMMARY.md) · `m18-2-browser.integration.test.ts` |
| **M18.3** | Outcome discovery and verified examples catalog | **#82** | **`abbc02b`** | [`M18_3_ACCEPTANCE_SUMMARY.md`](M18_3_ACCEPTANCE_SUMMARY.md) · `m18-3-browser.integration.test.ts` |
| **M18.4** | Unified guided onboarding | **#83** | **`64bafa1`** | [`M18_4_ACCEPTANCE_SUMMARY.md`](M18_4_ACCEPTANCE_SUMMARY.md) · `m18-4-browser.integration.test.ts` |
| **M18.5** | Agent Studio UX refinement | **#84** | **`1747b78`** | [`M18_5_ACCEPTANCE_SUMMARY.md`](M18_5_ACCEPTANCE_SUMMARY.md) · live **M13.3** / **M16.3** + mocked `m18-5-browser` |
| **UX V2.1** | Global product shell (nav, Create, Help, mobile drawer) | **#85** | **`bfb6b65`** | `ux-v2-shell-browser.integration.test.ts` · PR body: direct **M16.3** **PASS** |
| **UX V2.2** | Home redesign | **#86** | **`380efc0`** | `ux-v2-home-browser.integration.test.ts` |
| **UX V2.3** | Guided onboarding | **#87** | **`77ebeee`** | `ux-v2-onboarding-browser.integration.test.ts` |
| **UX V2.4** | Agent Studio (guided authoring, templates, review) | **#88** | **`814e9ca`** | Agent Studio browser acceptance (PR **#89** supersedes canvas scope with combined V2.4+V2.5) |
| **UX V2.5** | Workflow Studio (canvas-first builder) | **#89** | **`8fbf032`** | PR **#89**: **LOCAL_PASS** branch integration profile |
| **UX V2.6** | Activity, run detail, run history | **#90** | **`0d8df08`** | `ux-v2-activity/run-detail/run-history/workflow-run-detail-browser.integration.test.ts` · PR **#90**: full branch integration profile **PASS** |
| **UX V2.7** | Resources — models, integrations, knowledge, memory, testing | **#91** | **`b3c20e3`** | Unit/component V2.7 tests · mocked `ux-v2-*-browser` suites · PR **#91** verification table (§6) |
| **M18.10** | Milestone closeout (this document) | — | — | Documentation + roadmap reconciliation |

**PR #88** was superseded in product scope by **#89** (Agent + Workflow Studio combined); both merge commits remain on **`main`**.

---

## 3. Test evidence matrix (by class)

### 3.1 Mocked-API Playwright (no Docker)

Fast regression for shell and Resources UX; screenshots under `apps/console/artifacts/` (gitignored).

| Suite | Covers |
| --- | --- |
| `m18-1a/1b/2/3/4/5-browser.integration.test.ts` | M18.1–M18.5 |
| `ux-v2-shell/home/onboarding-browser.integration.test.ts` | V2.1–V2.3 |
| `ux-v2-models/integrations/knowledge/memory/testing-browser.integration.test.ts` | V2.7A–E |
| `ux-v2-activity/run-detail/run-history/workflow-run-detail-browser.integration.test.ts` | V2.6 |

Mock suites assert layout, themes (light/dark), responsive viewports (320–1440), horizontal overflow guards, and role-based navigation where applicable.

### 3.2 Live-stack browser (Docker: Postgres, Valkey, control plane)

| Suite | Recorded result | Notes |
| --- | --- | --- |
| **M13.3** Agent Studio | **PASS** (M18.5 closeout; PR **#91** isolation) | Real agent create + validation UX |
| **M16.3** first-agent onboarding | **PASS** (M18.5 closeout; PR **#85** direct; PR **#91** isolation) | Publish → run **SUCCEEDED** |
| **M13.6** workflow builder | **PASS** (PR **#90**; CI job **m12-3-browser-acceptance** on **`b3c20e3`**) | Legacy obligations updated for V2.6 UI |
| **M13.7.5** quality gates | **6/6 PASS in isolation** (PR **#91**) | See §6 — combined profile failure |
| **M12.3** cross-capability browser | **PASS in isolation** (PR **#91**) | Model + MCP connector path |

### 3.3 Unit and component tests

Representative V2.7 coverage: `models-page.test.tsx`, `tools-page.test.tsx`, `knowledge-page.test.tsx`, `memory-page.test.tsx`, `testing-studio-page.test.tsx`, resource presentation tests, `evaluation-run-launch-page.test.tsx`, `agent-studio.test.tsx`, `spa-routing.test.ts` (M18.5 stabilization).

**Console package test count:** grows with each slice; PR **#91** CI **`verify`** job **SUCCESS** on merge commit **`b3c20e3`**.

### 3.4 CI on `main` (merge **#91**)

| Job | Result |
| --- | --- |
| **verify** | **success** |
| **m12-3-acceptance** | **success** |
| **m12-3-browser-acceptance** | **success** |
| **compose-smoke** | **success** |
| **python-sdk** | **success** |

CI **does not** equate to a maintainer **`verify:branch --profile=integration`** combined obligation run on a V2.7-sized diff (see §6).

---

## 4. Accessibility and performance evidence

### 4.1 Accessibility (verified vs gap)

| Area | Verified evidence | Gap / not claimed |
| --- | --- | --- |
| Shell / drawer | M18.1: Escape, focus restore, `inert` when closed; V2.1 shell tests include mobile drawer interaction | No automated axe-core or WCAG audit suite |
| Shared UI | M18.1: focus-visible rings, landmarks, `ConfirmDialog` adoption | Not all destructive flows migrated from `window.confirm` |
| V2.7F cross-surface fixes | PR **#91** scope; component tests use roles/labels in places | **No** dedicated a11y regression harness for Resources routes |
| Keyboard-only journeys | Partial via Playwright clicks | Systematic keyboard navigation matrix **not** executed for V2.7 |

**Conclusion:** M18 ships **incremental** accessibility improvements and mock-browser interaction checks. **Full accessibility certification is not claimed.**

### 4.2 Performance (verified vs gap)

| Area | Verified evidence | Gap / not claimed |
| --- | --- | --- |
| Layout stability | Mock browser tests: horizontal overflow guards on Resources pages | No Lighthouse / Core Web Vitals budget |
| Test timeouts | Browser integration config: **300s** test/hook timeout; `fileParallelism: false` | Combined local integration runs can still exceed maintainer time budgets (§6) |
| Bundle size | **NOT RUN** for M18 closeout | No bundle regression gate recorded |

---

## 5. Security and architecture invariants

- **Scope:** `apps/console` client UX, BFF consumption unchanged in intent; no ToolGateway, ModelGateway, or auth contract edits in M18 merge series.
- **RBAC:** UI copy and control visibility respect workspace roles (M18.5 DEVELOPER/OWNER messaging fix documented in M18.5 summary).
- **Secrets:** No new client-side secret surfaces; existing `secret-leak.test.ts` pattern retained.

---

## 6. UX V2.7 — combined integration profile vs isolation (critical)

PR **#91** maintainer verification (authoritative for M18.10):

| Check | Combined `profile=integration` / full branch run | Isolation |
| --- | --- | --- |
| Console lint, typecheck, build | **PASS** | **PASS** |
| Focused V2.7 unit + mocked browser tests | **PASS** | **PASS** |
| M12.3 connector browser | — | **PASS** |
| M13.3 Agent Studio | — | **PASS** |
| M13.7.5 quality gates (scenario A) | **TIMEOUT** (combined run) | **6/6 PASS** |
| M16.3 onboarding | — | **PASS** |
| Full branch integration **LOCAL_PASS** | **NOT ACHIEVED** | N/A |

**Root cause:** PR **#91** states the combined-run timeout for **M13.7.5 scenario A** remains **unconfirmed** (resource contention, suite ordering, or Docker timing — not attributed to V2.7 UI logic).

**Acceptance stance:**

- **Feature delivery:** **ACCEPTED** — merged with CI green and isolation evidence.
- **Full integration profile on a V2.7-sized branch:** **EXCEPTION** — not verified **PASS**; do not cite as merge gate satisfaction for future mega-Console PRs without re-run.

**Clearing the exception (deferred):** `pnpm verify:branch -- --profile=integration` on a clean tree at **`b3c20e3`**, or split obligation scheduling / timeout tuning for evaluation browser suites.

---

## 7. Known limitations (product, not verification)

Carried from slice summaries and PR scope:

- Examples catalog (M18.3) is **Console-side**; no automatic backend catalog sync.
- Goal-discovery NL input deferred post–M18.2.
- Partial Agent publish recovery is **in-session** only (M18.5).
- Home and route bodies beyond listed slices may still use legacy patterns where not migrated.

---

## 8. Closeout checklist

| Item | Status |
| --- | --- |
| M18.1–M18.5 merged with slice acceptance docs | **PASS** |
| UX V2.1–V2.7 merged (**#85–#91**) | **PASS** |
| Mock + live isolation evidence for critical studios | **PASS** (scoped) |
| Combined integration profile for V2.7 closeout | **EXCEPTION** (§6) |
| Accessibility / performance certification | **NOT CLAIMED** (§4) |
| M18.10 acceptance summary | **PASS** (this document) |

**Blocking gaps for declaring M18 feature-complete:** **none**, provided §6 exception and §4 gaps remain explicitly documented in [`M18_CLOSEOUT_SUMMARY.md`](M18_CLOSEOUT_SUMMARY.md).
