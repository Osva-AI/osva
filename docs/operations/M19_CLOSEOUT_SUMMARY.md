# M19 Closeout Summary — Ecosystem readiness

Branch: **`docs/m19-final-closeout`** (from osva **`main`** @ **`cb46caf`**)

Audit baseline: [`M19_ECOSYSTEM_READINESS_AUDIT.md`](M19_ECOSYSTEM_READINESS_AUDIT.md)

Registry re-verified: **2026-11-06**

## 1. Executive summary

**M19 is complete (scoped).** Implementation, coordinated **npm publication** (11 packages), live registry acceptance on **`m17-114`** (**38 PASS, 0 FAIL, 0 SKIP, 0 NOT_RUN**), M13.7.5 full browser acceptance (**6/6 PASS**), and cross-repository compatibility documentation reconciliation are done across **Osva-AI/osva**, **osva-examples**, **osva-connectors**, and **osva-adapters**.

**Still out of scope / deferred (unchanged):** seven source-only connectors; Examples **01–18** on OSVA **1.0.0**; optional A1.4/A2.5 Docker adapter acceptance re-run; combined **`verify:branch --profile=integration`** Turbo tasks (skipped on documentation-only branches — not a substitute for the separately executed **6/6** browser suite).

This document remains the operator source of truth for M19 publication inventory and acceptance evidence.

## 2. M19.1–M19.6 scope and status

| Slice | Scope | Status | Evidence |
| --- | --- | --- | --- |
| **M19.1** | Ecosystem compatibility truth (**1.1.4** / **1.1.1**) | **Complete** | Four-repo COMPATIBILITY docs + this closeout |
| **M19.2** | Example 19 external npm-only consumer harness | **Complete** | osva-examples PR **#12**; harness merged |
| **M19.3** | Connector SDK **1.1.4** + Wave 1 + registry realignment | **Complete** | **8** connector npm versions published (see §6) |
| **M19.4** | Examples dual track | **Complete** | 01–18 **1.0.0**; 19 **1.1.4** npm line |
| **M19.5** | Adapters + sidecar on **1.1.4** contracts | **Complete** | **3** adapter npm packages published (see §7) |
| **M19.6** | **`m17-114`**, M13.7.5 hardening, MCP stdio cross-links | **Complete** | Live registry **38/38**; browser **6/6**; sync fix PR **#96** |

## 3. Merged PRs and commit references

| Repository | PR | Title | Merge commit | Notes |
| --- | ---: | --- | --- | --- |
| [Osva-AI/osva](https://github.com/Osva-AI/osva) | **#94** | M19.1 and M19.6: compatibility alignment and integration hardening | **`95d6fb0`** | Implementation baseline |
| [Osva-AI/osva](https://github.com/Osva-AI/osva) | **#96** | Fix M13.7.5 browser run-status synchronization | **`cb46caf`** | Scenario B race; no production behavior change |
| [Osva-AI/osva-examples](https://github.com/Osva-AI/osva-examples) | **#12**, **#13** | M19.2 harness; M19.1/M19.4 dual-track | **`9a0ea78`**, **`a52892b`** | |
| [Osva-AI/osva-connectors](https://github.com/Osva-AI/osva-connectors) | **#14** | M19.1/M19.3 SDK alignment | **`f2b2757`** | Publication executed post-merge (operator) |
| [Osva-AI/osva-adapters](https://github.com/Osva-AI/osva-adapters) | **#11** | M19.1/M19.5 adapter readiness | **`f4103ac`** | Publication executed post-merge (operator) |

## 4. Supported platform / npm version matrix

| Surface | Version | Notes |
| --- | --- | --- |
| OSVA platform (`VERSION`, GHCR/PyPI/Helm) | **1.1.1** | M16/M17 baseline |
| npm `@osva-ai/contracts`, `runtime-protocol`, `sdk`, `connector-sdk`, `cli` | **1.1.4** | **`latest`** / **`stable-candidate`** |
| Python `osva-sdk` (PyPI) | **1.1.1** | M17 record |
| Registry harness default | **`OSVA_REGISTRY_ACCEPTANCE_TARGET=m17-114`** | Platform **1.1.1** + npm **1.1.4** |
| Historical registry replay | **`m16-111`** | npm **1.1.2** on platform **1.1.1** |

## 5. M19 ecosystem npm publication matrix (11 packages)

All listed packages passed **clean installation from the public npm registry** (operator evidence, M19 acceptance).

| Package | Version | Category |
| --- | --- | --- |
| `@osva-ai/runtime-cli-sidecar` | **0.1.0** | New (M19.5) |
| `@osva-ai/connector-slack` | **0.1.0** | Wave 1 (M19.3) |
| `@osva-ai/connector-stripe` | **0.1.0** | Wave 1 (M19.3) |
| `@osva-ai/connector-hubspot` | **0.1.0** | Wave 1 (M19.3) |
| `@osva-ai/adapter-artifact-memory` | **0.1.2** | Realignment (M19.5); **`latest`** + **`rc`** → **0.1.2** |
| `@osva-ai/adapter-artifact-azure` | **0.1.2** | Realignment (M19.5); **`latest`** + **`rc`** → **0.1.2** |
| `@osva-ai/connector-github` | **0.3.1** | Realignment (M19.3); **`latest`** → **0.3.1** |
| `@osva-ai/connector-postgres` | **0.1.1** | Realignment (M19.3) |
| `@osva-ai/connector-shopify` | **0.1.1** | Realignment (M19.3) |
| `@osva-ai/connector-ga4` | **0.1.1** | Realignment (M19.3) |
| `@osva-ai/connector-npm` | **0.1.1** | Realignment (M19.3); **`latest`** → **0.1.1** |

Published connector tarballs declare **`@osva-ai/connector-sdk@1.1.4`** (registry metadata spot-check **2026-11-06**). Adapter tarballs declare **`@osva-ai/contracts@1.1.4`**.

## 6. Connector publication status (M19.3)

**On npm at M19-aligned versions:** **8 / 15** packages. **7 / 15** remain source-only (google-*, gsc, meta-ads, klaviyo, whatsapp, etc.) — **out of M19 scope**.

Canonical sibling doc: [osva-connectors/docs/M19_PUBLICATION_RECORD.md](https://github.com/Osva-AI/osva-connectors/blob/main/docs/M19_PUBLICATION_RECORD.md) · [compatibility.md](https://github.com/Osva-AI/osva-connectors/blob/main/docs/compatibility.md).

GitHub OIDC trusted publishing for connectors uses environment **`npm`** (workflow **`npm-release.yml`**).

## 7. Adapter and sidecar publication status (M19.5)

| Package | npm version | Dist-tags (2026-11-06) |
| --- | --- | --- |
| `@osva-ai/adapter-artifact-memory` | **0.1.2** | **`latest`**, **`rc`** → **0.1.2** |
| `@osva-ai/adapter-artifact-azure` | **0.1.2** | **`latest`**, **`rc`** → **0.1.2** |
| `@osva-ai/runtime-cli-sidecar` | **0.1.0** | first publication |

Canonical sibling doc: [osva-adapters/COMPATIBILITY.md](https://github.com/Osva-AI/osva-adapters/blob/main/COMPATIBILITY.md).

Post-publish workflow verification in **osva-adapters** uses **bounded registry polling** (up to 3 minutes) so npm processing delay does not fail successful publishes.

## 8. Examples compatibility policy (M19.4)

| Track | OSVA platform | npm | Examples |
| --- | --- | --- | --- |
| **Legacy** | **1.0.0** | **`@osva-ai/*@1.0.0`** | **01–18** |
| **1.1.x consumer** | **1.1.x** (acceptance **1.1.1**) | **`sdk` / `contracts` / `connector-sdk` @1.1.4**; Example 19 pins **`connector-npm@0.1.0`** | **19** only |

Canonical doc: [osva-examples/COMPATIBILITY.md](https://github.com/Osva-AI/osva-examples/blob/main/COMPATIBILITY.md).

## 9. Verification evidence

Classification: **PASS** = executed with success; **FAIL** = executed and failed; **NOT_RUN** = not executed in this closeout pass.

| Check | Result | Notes |
| --- | --- | --- |
| npm five-package line **1.1.4** | **PASS** | M17.9 + spot-check **2026-11-06** |
| M19 eleven-package npm publication | **PASS** | Operator publication + clean install |
| Registry metadata (`npm view`) M19 packages | **PASS** | This closeout pass **2026-11-06** |
| Live **`acceptance:m16-registry`** target **`m17-114`** | **PASS** | **38 PASS, 0 FAIL, 0 SKIP, 0 NOT_RUN** (not re-run in this doc PR) |
| M13.7.5 browser integration (full suite) | **PASS** | **6/6** (not re-run in this doc PR) |
| M13.7.5 browser helper tests | **PASS** | **4/4** (not re-run in this doc PR) |
| Scenario B synchronization fix | **PASS** | Merged **`cb46caf`** (PR **#96**) |
| `node --test scripts/acceptance/r11-registry-only/test/targets.test.mjs` | **PASS** | **8/8** (prior M19.6 record) |
| `verify:branch --profile=integration` (combined Turbo) | **NOT_RUN** | Documentation-only branches skip Turbo; **does not** negate **6/6** browser evidence |
| `verify:branch` (default) on closeout doc branch | **PASS** | **LOCAL_PASS** — docs link + diff check |
| `pnpm verify:ci:clean` | **NOT_RUN** | Documentation / targeted verification policy |
| Live registry / browser suites (this PR) | **NOT_RUN** | Not duplicated per closeout policy |

## 10. Remaining blockers

**None** for M19 scoped closeout criteria.

Post-M19 roadmap items (OIDC Community, Enterprise identity, unpublished connectors, legacy example migration) remain documented in [`STAGE_ROADMAP.md`](../roadmap/STAGE_ROADMAP.md).

## 11. Operator release checklist (M19 — completed)

- [x] Platform **1.1.1** + npm **1.1.4** five-pack unchanged
- [x] Connector Wave 1 + realignment published (**8** packages)
- [x] Adapter **0.1.2** + sidecar **0.1.0** published; artifact **`latest`** promoted
- [x] Clean external **`npm install`** for all **11** packages
- [x] Live **`m17-114`** registry acceptance **38/38**
- [x] M13.7.5 browser **6/6** + helper **4/4**
- [x] Cross-repo compatibility documentation reconciled

## 12. Closeout verification (this branch)

| Check | Result |
| --- | --- |
| `node scripts/release/docs-link-check.mjs` | See §13 (executed on PR branch) |
| `git diff --check` | See §13 |
| `pnpm exec prettier --check` (changed docs) | See §13 |
| `npm view` M19 package matrix | **PASS** (**2026-11-06**) |

## 13. Related documentation

| Document | Role |
| --- | --- |
| [`M19_ECOSYSTEM_READINESS_AUDIT.md`](M19_ECOSYSTEM_READINESS_AUDIT.md) | Inventory and gap analysis (reconciled) |
| [`../release/COMPATIBILITY.md`](../release/COMPATIBILITY.md) | Platform/npm policy |
| [`M17_ACCEPTANCE_SUMMARY.md`](M17_ACCEPTANCE_SUMMARY.md) | Prior external journey evidence |
| [`M18_CLOSEOUT_SUMMARY.md`](M18_CLOSEOUT_SUMMARY.md) | Combined integration exception origin |
| [`../roadmap/IMPLEMENTATION_TRACKER.md`](../roadmap/IMPLEMENTATION_TRACKER.md) | Milestone status |

**M19 milestone status:** **Complete (scoped).**
