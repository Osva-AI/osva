# M19 Closeout Summary — Ecosystem readiness

Branch: **`docs/m19-release-readiness-closeout`** (from osva **`main`** @ **`95d6fb0`**)

Audit baseline: [`M19_ECOSYSTEM_READINESS_AUDIT.md`](M19_ECOSYSTEM_READINESS_AUDIT.md)

Registry re-verified: **2026-11-05**

## 1. Executive summary

M19 **M19.1–M19.6 implementation is complete** across **Osva-AI/osva**, **osva-examples**, **osva-connectors**, and **osva-adapters**. Cross-repository compatibility documentation now agrees on **OSVA platform 1.1.1**, public npm **`@osva-ai/*@1.1.4`**, dual-track examples policy, connector SDK **1.1.4** source alignment, and adapter/sidecar package-ready versions.

**Not complete:** coordinated **npm publication** for connector Wave 1, connector registry realignment patches, adapter **`0.1.2`**, and first **`runtime-cli-sidecar@0.1.0`** publish; live **`acceptance:m16-registry`** on target **`m17-114`**; combined **`verify:branch --profile=integration`** with full M13.7.5 browser **6/6**.

This document is the single operator source of truth for ecosystem publication order and remaining acceptance gates.

## 2. M19.1–M19.6 scope and implementation status

| Slice | Scope | Implementation status | Publication / acceptance |
| --- | --- | --- | --- |
| **M19.1** | Ecosystem compatibility truth (**1.1.4** / **1.1.1**) | **Complete** — all four repos | Refresh docs after npm wave |
| **M19.2** | Example 19 external npm-only consumer harness | **Complete** — merged + CI | Harness re-run optional post-publish |
| **M19.3** | Connector SDK **1.1.4** + Wave 1 prep | **Complete (package-ready)** | **npm not published** (5/15 on registry at legacy tarballs) |
| **M19.4** | Examples dual track | **Complete** — 01–18 **1.0.0**, 19 **1.1.4** | No bump of 01–18 by design |
| **M19.5** | Adapters + sidecar on **1.1.4** contracts | **Complete (package-ready)** | **npm publish pending** |
| **M19.6** | **`m17-114`** default, M13.7.5 hardening, MCP stdio cross-links | **Complete (osva code/docs)** | Combined browser + live registry **NOT_RUN** in closeout |

## 3. Merged PRs and commit references

| Repository | PR | Title | Merge commit | CI (merge) |
| --- | ---: | --- | --- | --- |
| [Osva-AI/osva](https://github.com/Osva-AI/osva) | **#94** | M19.1 and M19.6: compatibility alignment and integration hardening | **`95d6fb011f303ddb522b4d47a763d441ce95b407`** | **`verify`**, **`compose-smoke`**, **`m12-3-acceptance`**, **`m12-3-browser-acceptance`**, **`python-sdk`** — **pass** |
| [Osva-AI/osva-examples](https://github.com/Osva-AI/osva-examples) | **#12** | M19.2 external consumer acceptance | **`9a0ea78cc060ffb8da286c168f6730207e2e2388`** | **`offline-validation`** — **pass** |
| [Osva-AI/osva-examples](https://github.com/Osva-AI/osva-examples) | **#13** | M19.1/M19.4 dual-track examples compatibility | **`a52892b60caa3a8007d11c1764fdc25c4f34edf1`** | **`offline-validation`** — **pass** |
| [Osva-AI/osva-connectors](https://github.com/Osva-AI/osva-connectors) | **#14** | M19.1/M19.3 SDK 1.1.4 alignment and connector release readiness | **`f2b2757ea764894df50ff2833ef081134c81c2a8`** | **`verify`**, **PostgreSQL integration** — **pass** |
| [Osva-AI/osva-adapters](https://github.com/Osva-AI/osva-adapters) | **#11** | M19.1/M19.5 adapter compatibility and distribution readiness | **`f4103ac6bd39e8e7e06e02191991f4f8066b6bc4`** | Lint/build/unit, pack consumers, A2.6 sidecar readiness — **pass** |

Sibling **`main`** heads at closeout: osva-connectors **`f2b2757`**, osva-adapters **`f4103ac`**, osva-examples includes **`a52892b`**.

## 4. Supported platform / npm version matrix

| Surface | Version | Notes |
| --- | --- | --- |
| OSVA platform (`VERSION`, GHCR/PyPI/Helm) | **1.1.1** | M16/M17 baseline; unchanged in M19 |
| npm `@osva-ai/contracts`, `runtime-protocol`, `sdk`, `connector-sdk`, `cli` | **1.1.4** | **`latest`** / **`stable-candidate`** (`npm view`, 2026-11-05) |
| Python `osva-sdk` (PyPI) | **1.1.1** | M17 record; not re-fetched in this pass |
| Historical RC.4 Docker acceptance | **`v1.1.0-rc.4`** → **`cd38eea`** | Documented baseline only; not current line |
| Registry harness default | **`OSVA_REGISTRY_ACCEPTANCE_TARGET=m17-114`** | Platform **1.1.1** + npm **1.1.4** (M19.6) |
| Historical registry replay | **`m16-111`** | npm **1.1.2** on platform **1.1.1** |

**Rule:** External packages should declare **`@osva-ai/*@1.1.4`** (or semver range including it). Do not mix published **rc.2** connector tarballs with **1.1.4** platform SDK without explicit legacy documentation.

## 5. Examples compatibility policy (M19.4)

| Track | OSVA platform | npm | Examples | Verification |
| --- | --- | --- | --- | --- |
| **Legacy** | **1.0.0** | **`@osva-ai/*@1.0.0`** | **01–18** | osva-examples root `pnpm verify` |
| **1.1.x consumer** | **1.1.x** (acceptance **1.1.1**) | **`sdk` / `contracts` / `connector-sdk` @1.1.4**; **`connector-npm@0.1.0`** | **19** only | Example 19 tests + [M19.2 harness](https://github.com/Osva-AI/osva-examples/blob/main/docs/M19_2_EXTERNAL_CONSUMER_ACCEPTANCE.md) |

Canonical doc: [osva-examples/COMPATIBILITY.md](https://github.com/Osva-AI/osva-examples/blob/main/COMPATIBILITY.md).

## 6. Connector publication status (M19.3)

**Source (`osva-connectors` `main`):** all 15 packages pin **`@osva-ai/connector-sdk@1.1.4`**.

**Registry (2026-11-05):** **5/15** published; published tarballs still embed legacy SDK deps until new semver ships.

### Wave 1 (first publication @ **0.1.0**)

| Package | Repo path | Repo version | npm | Blocker |
| --- | --- | --- | --- | --- |
| `@osva-ai/connector-slack` | `packages/slack` | **0.1.0** | **404** | Manual publish + OIDC/trusted publisher if first org publish |
| `@osva-ai/connector-stripe` | `packages/stripe` | **0.1.0** | **404** | Same |
| `@osva-ai/connector-hubspot` | `packages/hubspot` | **0.1.0** | **404** | Same |

### Registry realignment (immutable versions — ship **new semver**)

| Package | Repo version today | npm `latest` | Intended release | SDK in published tarball | Repo SDK pin |
| --- | --- | --- | --- | --- | --- |
| `@osva-ai/connector-github` | **0.3.0** | **0.3.0** | **`0.3.1`** | **1.1.0-rc.2** | **1.1.4** |
| `@osva-ai/connector-postgres` | **0.1.0** | **0.1.0** | **`0.1.1`** | **1.1.0-rc.2** | **1.1.4** |
| `@osva-ai/connector-shopify` | **0.1.0** | **0.1.0** | **`0.1.1`** | **1.1.0-rc.2** | **1.1.4** |
| `@osva-ai/connector-ga4` | **0.1.0** | **0.1.0** | **`0.1.1`** | **1.1.0-rc.2** | **1.1.4** |
| `@osva-ai/connector-npm` | **0.1.0** | **0.1.0** | **`0.1.1`** | **1.1.3** | **1.1.4** |

**Remaining 7 connectors:** source-only on npm (gsc, google-*, meta-ads, klaviyo, whatsapp, etc.) — out of M19 Wave 1 scope.

Release workflows: per-package **`RELEASE-CHECKLIST*.md`** in [osva-connectors](https://github.com/Osva-AI/osva-connectors/tree/main/docs). **Recommended dist-tag:** **`latest`** for new stable connector lines (no automatic publish on merge).

## 7. Adapter and sidecar publication status (M19.5)

| Package | Repo path | Repo version | npm `latest` (2026-11-05) | Declared deps | CI acceptance (PR #11) |
| --- | --- | --- | --- | --- | --- |
| `@osva-ai/adapter-artifact-memory` | `packages/artifact-memory` | **0.1.2** | **0.1.0** (`rc` → **0.1.1**) | **`@osva-ai/contracts@1.1.4`** | Pack + external consumer |
| `@osva-ai/adapter-artifact-azure` | `packages/artifact-azure` | **0.1.2** | **0.1.0** | **`@osva-ai/contracts@1.1.4`** | Azurite integration |
| `@osva-ai/runtime-cli-sidecar` | `packages/runtime-cli-sidecar` | **0.1.0** | **404** | **`contracts` / `runtime-protocol` / `sdk` @1.1.4** | A2.6 release readiness |

Canonical doc: [osva-adapters/COMPATIBILITY.md](https://github.com/Osva-AI/osva-adapters/blob/main/COMPATIBILITY.md).

**Immutable-version note:** Cannot republish **0.1.0** / **0.1.1** adapter tarballs with **1.1.4** contracts; ship **`0.1.2`** and move **`latest`** after clean-install smoke.

**A1.4 / A2.5 Docker acceptance:** documented optional gates; **not re-run** for M19 PR prep (osva-adapters COMPATIBILITY.md).

## 8. Verification evidence

Classification: **PASS** = executed with success; **FAIL** = executed and failed; **NOT_RUN** = not executed in this closeout (not claimed passed).

| Check | Result | Notes |
| --- | --- | --- |
| npm five-package line **1.1.4** | **PASS** | M17.9 + spot-check 2026-11-05 |
| osva PR **#94** CI | **PASS** | GitHub Actions on merge |
| Sibling M19 PR CI | **PASS** | See §3 |
| `node --test scripts/acceptance/r11-registry-only/test/targets.test.mjs` | **PASS** | **8/8** (M19.6 / audit record) |
| `m13-7-5-browser-helpers.test.ts` | **PASS** | **2/2** (M19.6 / audit record) |
| `m13-7-5-browser.integration.test.ts` scenario A (isolated) | **PASS** | **1/1** (2026-11-05 audit) |
| `m13-7-5-browser.integration.test.ts` full **6/6** | **NOT_RUN** | Isolated PASS does not imply combined PASS |
| `verify:branch --profile=integration` (combined) | **NOT_RUN** | M18.10 exception; M19.6 closeout gate |
| `acceptance:m16-registry` live **`m17-114`** | **NOT_RUN** | Platform/npm already published; replay not repeated for docs |
| Example 19 M19.2 harness post-merge | **NOT_RUN** | Merged; optional operator smoke |
| M19 closeout `docs-link-check` | See §12 | This branch |
| `pnpm verify:ci:clean` | **NOT_RUN** | Documentation-only closeout policy |

### M19.6 — runnable deferred gates

**Combined browser (M13.7.5 full suite):**

```powershell
pnpm --filter @osva/console exec vitest run --config vitest.integration.browser.config.ts test/integration/m13-7-5-browser.integration.test.ts
```

Prerequisites: Docker, Playwright, fresh Console client build, isolated worker stack per [`M13_7_5_ACCEPTANCE_SUMMARY.md`](M13_7_5_ACCEPTANCE_SUMMARY.md).

**Combined integration profile:**

```powershell
pnpm verify:branch --profile=integration
```

Completion: **LOCAL_PASS** including M13.7.5 **6/6** without scenario A timeout (M18.10 regression).

**Live registry acceptance (`m17-114`):**

```powershell
$env:OSVA_M16_REGISTRY_ACCEPTANCE = "1"
$env:OSVA_REGISTRY_ACCEPTANCE_TARGET = "m17-114"
$env:OSVA_M16_ARTIFACT_SOURCE = "published"
$env:OSVA_ACCEPTANCE_LIVE = "1"
pnpm acceptance:m16-registry
```

Prerequisites: published GHCR **`ghcr.io/osva-ai/osva:1.1.1`**, npm **`@osva-ai/*@1.1.4`**, digests in `scripts/acceptance/r11-registry-only/lib/targets.mjs`. Isolation: dynamic loopback ports, Compose project **`osva-m17-registry-114`** — see [`scripts/acceptance/m16-registry/README.md`](../../scripts/acceptance/m16-registry/README.md).

## 9. Deferred acceptance and release blockers

| Blocker | Type | Unblocks |
| --- | --- | --- |
| Connector Wave 1 npm publish | Distribution | External install slack/stripe/hubspot |
| Connector realignment **0.3.1** / **0.1.1** | Distribution | Registry SDK **1.1.4** truth for five published connectors |
| Adapter **`0.1.2`** + sidecar **`0.1.0`** npm | Distribution | REMOTE_HTTP sidecar without git checkout |
| Live **`m17-114`** registry replay | Acceptance | M19.6 sign-off on published coordinates |
| Combined M13.7.5 browser under integration profile | Acceptance | M19.6 sign-off on M18.10 exception |
| Post-publish compatibility matrix refresh | Documentation | Accurate npm `latest` tables |

## 10. Release execution order and completion criteria

Recommended **manual** publication order (no CI auto-publish):

1. **Pre-flight:** `npm view` / dist-tags for all targets; osva + sibling **`main`** CI green; bump repo semver where table shows **intended release** ≠ **repo version** (connectors: patch before publish).
2. **Connector realignment patches:** **github 0.3.1**, **postgres / shopify / ga4 / npm 0.1.1** — `pnpm pack`, tarball inspect **`@osva-ai/connector-sdk@1.1.4`**, unit/MCP tests, manual **`npm publish`**.
3. **Connector Wave 1 first publish:** **slack**, **stripe**, **hubspot** @ **0.1.0** — first-publication OIDC/trusted publisher per connector checklist.
4. **Adapters:** publish **`@osva-ai/adapter-artifact-memory@0.1.2`** and **`@osva-ai/adapter-artifact-azure@0.1.2`**; promote **`latest`**; clean-install smoke with **`@osva-ai/contracts@1.1.4`**.
5. **Sidecar:** first publish **`@osva-ai/runtime-cli-sidecar@0.1.0`**; run strict **`pnpm test:release-readiness:a2-6`** ( **`--require-a25`** ) on maintainer machine/CI.
6. **Post-publication:** `npm view` verification; optional Example 19 M19.2 harness; update compatibility tables in four repos.
7. **Acceptance:** live **`acceptance:m16-registry`** on **`m17-114`**; then **`verify:branch --profile=integration`** if combined browser still required for sign-off.

**M19 milestone sign-off criteria:** Steps **1–6** complete for scoped packages; step **7** **PASS** for **`m17-114`** and documented decision on combined browser gate.

## 11. Operator release checklist (concise)

- [ ] Registry spot-check: platform **1.1.1** image + npm **1.1.4** five-pack unchanged
- [ ] Target repo **`main`** CI green (connectors/adapters/examples as touched)
- [ ] Semver bumped in repo where immutable npm version requires new patch/minor
- [ ] `pnpm pack` / `npm pack` + inspect `dependencies` / `peerDependencies`
- [ ] npm org access + trusted publisher / OIDC for **first** package names
- [ ] Manual `npm publish` (no push-to-publish workflow)
- [ ] Post-publish clean install in empty directory (`npm init -y` + install pins)
- [ ] `npm view @scope/pkg version` and dist-tag **`latest`**
- [ ] Refresh COMPATIBILITY docs + this closeout inventory
- [ ] Run **`m17-114`** registry acceptance when ecosystem pins change materially
- [ ] M19 final acceptance sign-off recorded in tracker

## 12. Closeout verification (this branch)

| Check | Result |
| --- | --- |
| `node scripts/release/docs-link-check.mjs` | **PASS** (173 markdown files) |
| `git diff --check` | **PASS** |
| `pnpm exec prettier --check` (changed docs only) | **PASS** |
| `pnpm verify:branch` (default profile) | **LOCAL_PASS** — docs link + git diff only (no package Turbo tasks) |
| `pnpm verify:ci:clean` | **NOT_RUN** (documentation-only closeout) |

## 13. Related documentation

| Document | Role |
| --- | --- |
| [`M19_ECOSYSTEM_READINESS_AUDIT.md`](M19_ECOSYSTEM_READINESS_AUDIT.md) | Inventory and gap analysis |
| [`../release/COMPATIBILITY.md`](../release/COMPATIBILITY.md) | Platform/npm policy |
| [`M17_ACCEPTANCE_SUMMARY.md`](M17_ACCEPTANCE_SUMMARY.md) | Prior external journey evidence |
| [`M18_CLOSEOUT_SUMMARY.md`](M18_CLOSEOUT_SUMMARY.md) | Combined integration exception origin |
| [`../roadmap/IMPLEMENTATION_TRACKER.md`](../roadmap/IMPLEMENTATION_TRACKER.md) | Milestone status |

**M19 milestone status:** **Implementation complete (scoped)**. **Ecosystem publication and deferred acceptance gates remain open.**
