# M19 Ecosystem Readiness Audit

**Audit date:** 2026-11-05 (registry re-verified **2026-11-05**; cross-repository closeout reconciled on branch `docs/m19-release-readiness-closeout`)
**Auditor context:** M19.1–M19.6 implementation merged on all four repositories; osva baseline **`origin/main`** @ **`95d6fb0`** (PR **#94**).
**Closeout record:** [`M19_CLOSEOUT_SUMMARY.md`](M19_CLOSEOUT_SUMMARY.md)
**Verification policy:** [`../engineering/DEVELOPMENT_GATES.md`](../engineering/DEVELOPMENT_GATES.md) · [`../engineering/BRANCH_VERIFICATION.md`](../engineering/BRANCH_VERIFICATION.md) (no separate `ENGINEERING_VERIFICATION_PLAYBOOK.md` in repo).

**Repositories inspected (local checkouts + npm registry):**

| Repository | Role | Package count (confirmed) |
| --- | --- | ---: |
| [Osva-AI/osva](https://github.com/Osva-AI/osva) | Core platform, published npm SDK line | 5 public npm packages |
| [Osva-AI/osva-connectors](https://github.com/Osva-AI/osva-connectors) | MCP connectors | **15** under `packages/` |
| [Osva-AI/osva-examples](https://github.com/Osva-AI/osva-examples) | Reference applications | **19** under `examples/` |
| [Osva-AI/osva-adapters](https://github.com/Osva-AI/osva-adapters) | External infrastructure adapters | **3** under `packages/` |
| [Osva-AI/osva-site](https://github.com/Osva-AI/osva-site) | Marketing site (Next.js) | **0** npm product packages |

Prior audit: [`../architecture/EXTERNAL_ECOSYSTEM_COMPATIBILITY.md`](../architecture/EXTERNAL_ECOSYSTEM_COMPATIBILITY.md) (M12.4 boundary rules — **superseded for version/publication facts** by this document and [`../release/COMPATIBILITY.md`](../release/COMPATIBILITY.md)).

### M19 slice status (four-repository closeout)

| Slice | Status | Evidence |
| --- | --- | --- |
| **M19.1** | **Complete** — cross-repository compatibility docs aligned to platform **1.1.1** + npm **1.1.4** | osva **#94**; osva-examples **#13**; osva-connectors **#14**; osva-adapters **#11** |
| **M19.2** | **Complete** — Example 19 npm-only external-consumer harness | [osva-examples PR #12](https://github.com/Osva-AI/osva-examples/pull/12) → **`9a0ea78`** |
| **M19.3** | **Complete (package-ready)** — all connector sources pin **`@osva-ai/connector-sdk@1.1.4`**; Wave 1 + registry realignment documented; **npm publication not complete** | osva-connectors **`f2b2757`** · [`docs/compatibility.md`](https://github.com/Osva-AI/osva-connectors/blob/main/docs/compatibility.md) |
| **M19.4** | **Complete** — dual-track examples policy (01–18 **1.0.0**, 19 **1.1.4**) | osva-examples **`a52892b`** · [`COMPATIBILITY.md`](https://github.com/Osva-AI/osva-examples/blob/main/COMPATIBILITY.md) |
| **M19.5** | **Complete (package-ready)** — artifact adapters **`0.1.2`** + sidecar **`0.1.0`** on **`@osva-ai/contracts@1.1.4`**; **npm publication pending** | osva-adapters **`f4103ac`** · [`COMPATIBILITY.md`](https://github.com/Osva-AI/osva-adapters/blob/main/COMPATIBILITY.md) |
| **M19.6** | **Implementation complete (osva)** — **`m17-114`** harness default, M13.7.5 polling/timeouts, MCP stdio cross-links; **combined integration + live registry replay not run** in closeout | osva **#94** → **`95d6fb0`** |

---

## 1. Supported OSVA release lines (canonical)

| Surface | Version | Registry check (2026-11-05) |
| --- | --- | --- |
| Platform (`VERSION`, GHCR/PyPI/Helm) | **1.1.1** | In-repo file |
| npm `@osva-ai/contracts`, `runtime-protocol`, `sdk`, `connector-sdk`, `cli` | **1.1.4** (`latest`, `stable-candidate`) | **`npm view` → 1.1.4** |
| npm `@osva-ai/connector-npm` | **0.1.0** | **Published** |
| Python `osva-sdk` (PyPI) | **1.1.1** | M17 record (not re-fetched in this pass) |

**Support classes**

| Class | Meaning |
| --- | --- |
| **Current supported** | Platform **1.1.1** + npm **`@osva-ai/*@1.1.4`** (five packages); registry harness target **`m17-114`** |
| **Legacy registry-verified** | npm **1.1.2** on platform **1.1.1** — target **`m16-111`** (M16 Stage B evidence; unchanged) |
| **Legacy compatibility** | npm **`1.1.0-rc.4`**, platform **1.1.0**, osva-examples **1.0.0** track — documented only |
| **Package-ready / unpublished** | Connector Wave 1 (**slack**, **stripe**, **hubspot**), registry realignment patches (**github** **0.3.1**, **postgres** / **shopify** / **ga4** / **npm** **0.1.1**), adapters **`0.1.2`**, **`runtime-cli-sidecar@0.1.0`** |
| **Acceptance deferred** | Live **`acceptance:m16-registry`** on **`m17-114`**; combined **`verify:branch --profile=integration`**; full M13.7.5 browser **6/6** under combined profile |

**Compatibility rule for M19:** External packages should target **`@osva-ai/*@1.1.4`** (or explicit semver range including it). **`1.1.0-rc.4`** / **`1.1.0-rc.2`** pins in osva-adapters and most connectors are **legacy** relative to the public npm line.

---

## 2. osva-connectors inventory (15 packages)

Status legend:

- **Implemented** — source + README in repo
- **Tested** — vitest suites (unit/fake HTTP/MCP); not proof of live provider success
- **Published** — `npm view @osva-ai/connector-<name> version` succeeds
- **Externally verified** — OSVA ToolGateway cross-repo CI or operator acceptance on published tarball

| Package | Ver. | `@osva-ai/connector-sdk` pin | Published | Test evidence (repo) | Credentials / controls | Known limitations |
| --- | --- | --- | --- | --- | --- | --- |
| `@osva-ai/connector-github` | **0.3.0** (next **`0.3.1`**) | **1.1.4** (source) | **Yes** (`0.3.0` tarball SDK **1.1.0-rc.2**) | architecture, mcp, fake provider | GitHub PAT / OAuth | Republish **`0.3.1`** for SDK alignment |
| `@osva-ai/connector-postgres` | **0.1.0** (next **`0.1.1`**) | **1.1.4** (source) | **Yes** (`0.1.0` tarball SDK **1.1.0-rc.2**) | architecture, mcp, fake provider | DB URL via secrets | Republish **`0.1.1`** |
| `@osva-ai/connector-shopify` | **0.1.0** (next **`0.1.1`**) | **1.1.4** (source) | **Yes** | architecture, mcp, fake provider | Shopify access token | Republish **`0.1.1`** |
| `@osva-ai/connector-ga4` | **0.1.0** (next **`0.1.1`**) | **1.1.4** (source) | **Yes** | architecture, mcp, fake provider | Google service account | Republish **`0.1.1`** |
| `@osva-ai/connector-npm` | **0.1.0** (next **`0.1.1`**) | **1.1.4** (source) | **Yes** (tarball SDK **1.1.3**) | architecture, mcp, registry client tests | Public registry (no secret) | M17 real-world path; republish **`0.1.1`** |
| `@osva-ai/connector-google-ads` | 0.1.0 | **1.1.0-rc.2** | **No** | Same pattern as peers | Google Ads OAuth | Not installable from npm |
| `@osva-ai/connector-google-drive` | 0.1.0 | **1.1.0-rc.2** | **No** | — | Google OAuth | Not on registry |
| `@osva-ai/connector-google-sheets` | 0.1.0 | **1.1.0-rc.2** | **No** | — | Google OAuth | Not on registry |
| `@osva-ai/connector-gsc` | 0.1.0 | **1.1.0-rc.2** | **No** | — | Search Console OAuth | Not on registry |
| `@osva-ai/connector-hubspot` | 0.1.0 | **1.1.4** (source) | **No** | — | HubSpot token | **Wave 1** publication-ready |
| `@osva-ai/connector-klaviyo` | 0.1.0 | **1.1.4** (source) | **No** | — | Klaviyo API key | Not on registry |
| `@osva-ai/connector-meta-ads` | 0.1.0 | **1.1.4** (source) | **No** | — | Meta app secret + token | Not on registry |
| `@osva-ai/connector-slack` | 0.1.0 | **1.1.4** (source) | **No** | — | Slack bot token | **Wave 1** publication-ready |
| `@osva-ai/connector-stripe` | 0.1.0 | **1.1.4** (source) | **No** | — | Stripe secret key | **Wave 1** publication-ready |
| `@osva-ai/connector-whatsapp` | 0.1.0 | **1.1.0-rc.2** | **No** | — | Meta WhatsApp token | Not on registry |

**Publication summary:** **5 / 15** published on npm at legacy tarballs (**github** **0.3.0**, **postgres** / **shopify** / **ga4** / **npm** **0.1.0**). **10 / 15** source-only on registry (`npm view` **2026-11-05**). Source on **`main`** pins **`connector-sdk@1.1.4`**; immutable registry tarballs still carry **rc.2** / **1.1.3** until patch/Wave 1 publish.

**Docs:** [`osva-connectors/docs/compatibility.md`](https://github.com/Osva-AI/osva-connectors/blob/main/docs/compatibility.md) records Wave 1, realignment semver, and release checklists (M19.1 / M19.3).

**OSVA cross-repo evidence:** osva CI job **m12-3-acceptance** / **github-connector-integration** (pinned connector SHA) proves **GitHub** (+ postgres in M12.4 history) against in-repo stack — **not** automatic proof for unpublished connectors.

---

## 3. osva-examples inventory (19 examples)

Repo [`COMPATIBILITY.md`](https://github.com/Osva-AI/osva-examples/blob/main/COMPATIBILITY.md) documents **dual tracks**: legacy **1.0.0** (Examples **01–18**) and **1.1.x consumer** (Example **19** only).

| Example | `@osva-ai/sdk` pin | OSVA line | Tests (repo) | Published consumer proof |
| --- | --- | --- | --- | --- |
| **01–18** | **1.0.0** | 1.0.x | Per-example vitest (smoke, agent, bootstrap patterns) | **Not verified** in this audit |
| **19-research-report-agent** | **`@osva-ai/sdk` / `contracts` / `connector-sdk` @ 1.1.4** | **1.1.x** | `test/*.test.ts` (agent, connector, bootstrap, mcp-http, model-profile) | **M17.8** operator workflow; **M19.2** external-consumer harness ([PR #12](https://github.com/Osva-AI/osva-examples/pull/12)) |

**Verified (2026-11-05):** `examples/19-research-report-agent/package.json` on **osva-examples `main`** pins **`@osva-ai/sdk@1.1.4`**, **`@osva-ai/contracts@1.1.4`**, **`@osva-ai/connector-sdk@1.1.4`**, **`@osva-ai/connector-npm@0.1.0`**.

**M19.4 policy:** Examples **01–18** intentionally remain on **`@osva-ai/sdk@1.0.0`**; Example **19** is the **1.1.x** external-consumer golden path. Migration guide: [`docs/MIGRATION_1_0_TO_1_1.md`](https://github.com/Osva-AI/osva-examples/blob/main/docs/MIGRATION_1_0_TO_1_1.md).

**No** dedicated integration test directory under example 19 that runs against a live OSVA stack from a clean external install — validation is **unit-level** + **M17 operator** acceptance.

---

## 4. osva-adapters inventory (3 packages)

| Package | Ver. (repo) | npm published | Dependency pins | Registration | Test / acceptance evidence |
| --- | --- | --- | --- | --- | --- |
| `@osva-ai/adapter-artifact-memory` | **`0.1.2`** | **Yes** (`latest` → **`0.1.0`**; **`0.1.1`** on **`rc`**) | **`@osva-ai/contracts@1.1.4`** | `OSVA_ARTIFACT_BLOB_STORE_REGISTER_MODULE` | A1.5 pack + external consumer CI (PR **#11**) |
| `@osva-ai/adapter-artifact-azure` | **`0.1.2`** | **Yes** (same dist-tags) | **`@osva-ai/contracts@1.1.4`** + Azure SDK | Same registered driver pattern | Azurite integration CI (PR **#11**) |
| `@osva-ai/runtime-cli-sidecar` | **`0.1.0`** | **No** (`npm view` **404**) | **`@osva-ai/contracts`**, **`runtime-protocol`**, **`sdk` @1.1.4** | Runtime Protocol V1 sidecar (REMOTE_HTTP) | A2.6 release-readiness CI (PR **#11**); first publish pending |

**Publication blockers:**

- Registry **`latest`** still **`0.1.0`** for artifact adapters while repo is **`0.1.2`** — publish **`0.1.2`** and promote **`latest`** after tarball smoke.
- **Sidecar** never published — first publication requires npm trusted publisher / OIDC setup per [`MAINTAINER_RELEASE.md`](https://github.com/Osva-AI/osva-adapters/blob/main/docs/release/MAINTAINER_RELEASE.md).
- **Registration** requires operator env (`OSVA_ARTIFACT_STORAGE_DRIVER=registered`) — not Console-clickable.

---

## 5. osva-site

| Attribute | Value |
| --- | --- |
| Purpose | Public marketing / platform pages (Next.js 16) |
| OSVA runtime dependency | **None** |
| npm publication | **private** (`"private": true`) |
| Ecosystem acceptance | **Out of scope** for agent/connector journeys |

---

## 6. Compatibility gaps (priority order)

| # | Gap | Impact |
| --- | --- | --- |
| G1 | **Published connector tarballs** still on **rc.2** / **1.1.3** SDK deps | **Resolved in source**; **npm realignment patches** (**0.3.1**, **0.1.1**) pending |
| G2 | **10 connectors unpublished** (+ Wave 1) | External `npm install` blocked until manual publish |
| G3 | ~~Dual-track examples undocumented~~ | **Closed (M19.4)** — explicit legacy vs **1.1.x** tracks |
| G4 | **Adapters `0.1.2` / sidecar** not on npm **`latest`** | Publish + post-install smoke before external claims |
| G5 | **MCP stdio** on worker | Requires explicit operator opt-in (`OSVA_MCP_CONNECTOR_STDIO*`, allowlists); Example 19 documents; not default in production |
| G6 | ~~**`m16-111`** harness npm pin **1.1.2**~~ → **`m17-114`** default (**1.1.4**) in osva (M19.6); **`m16-111`** retained for historical replay | — |
| G7 | **M13.7.5** combined integration timeout (M18.10) | Mitigated: API-first run status polling + align per-test timeout with vitest **300s** harness budget (M19.6) |

---

## 7. First external developer acceptance journey

**Target path (prioritized):**

1. Published OSVA platform **1.1.1** (GHCR) + npm **`@osva-ai/cli@1.1.4`** (`osva setup --remote-http-dev` or equivalent).
2. Published **`@osva-ai/connector-npm@0.1.0`** (stdio or HTTP bridge per Example 19).
3. **Example 19** (research-report-agent) — closest **1.1.x** research workflow.
4. Model execution via ModelGateway (operator model credentials).
5. Artifact retrieval + run inspection (M17.8 evidence).

### Existing M17 evidence (do not duplicate)

| Step | Status | Evidence |
| --- | --- | --- |
| Published npm **1.1.4** five-package line | **Verified** | [`M17_ACCEPTANCE_SUMMARY.md`](M17_ACCEPTANCE_SUMMARY.md) §2 |
| **`connector-npm@0.1.0`** registry | **Verified** | `npm view` |
| Full model + MCP + workflow + artifact | **Verified** | M17.8 run **`a409acad-b3be-47d1-97fc-689158f39b54`** |
| Clean CLI install / remote-http-dev READY | **Verified** | M17.9 operator smoke (**no** workflow replay) |

### Gaps for a **new** external-consumer check (justified only if M17 evidence ages out)

| Step | Status this audit | Blocker |
| --- | --- | --- |
| Example 19 external-consumer harness (npm-only) | **Merged** (osva-examples PR **#12**); **not re-run** in this osva pass | Run harness in osva-examples CI or post-merge smoke |
| Stdio MCP on worker without monorepo paths | **Deferred** | Operator stdio allowlist + worker package install |
| Examples **01–18** on **1.1.4** | **NOT EXECUTED** | Major compatibility project |

**Conclusion:** M19 **implementation** is complete across four repositories. Remaining work is **distribution execution** (connector/adapters npm), live **`m17-114`** registry replay, and optional combined integration browser gate — **not** a full M17.8 workflow replay unless platform coordinates change.

---

## 8. M19.1–M19.6 closeout status

| Slice | Implementation | Distribution / acceptance still open |
| --- | --- | --- |
| **M19.1** | **Complete** — four-repo `COMPATIBILITY` / audit cross-links | Refresh matrices after npm publish |
| **M19.2** | **Complete** — PR **#12** | Re-run harness post-publish optional |
| **M19.3** | **Complete (package-ready)** — PR **#14** | Wave 1 + **0.3.1** / **0.1.1** connector publishes |
| **M19.4** | **Complete** — PR **#13** | Examples **01–18** stay **1.0.0** by policy |
| **M19.5** | **Complete (package-ready)** — PR **#11** | **`0.1.2`** adapters + sidecar **`0.1.0`** npm |
| **M19.6** | **Complete (code/docs)** — PR **#94** | Combined browser **6/6**; live **`m17-114`** registry |

**Operator plan:** [`M19_CLOSEOUT_SUMMARY.md`](M19_CLOSEOUT_SUMMARY.md) §9–§10.

---

## 9. Audit verification performed

| Check | Result |
| --- | --- |
| Package counts (15 / 19 / 3) | **Confirmed** via filesystem |
| npm registry spot-check (connectors, adapters, `@osva-ai/sdk`) | **Executed** (2026-11-05) |
| osva-examples Example **19** `package.json` on **`main`** | **Verified** — `@osva-ai/sdk` / `contracts` / `connector-sdk` **1.1.4** |
| Live Example 19 end-to-end | **Deferred** (M17.8 + M19.2 harness evidence; not re-run here) |
| `node --test scripts/acceptance/r11-registry-only/test/targets.test.mjs` | **PASS** (8/8) |
| `pnpm --filter @osva/console exec vitest run test/m13-7-5-browser-helpers.test.ts` | **PASS** (2/2) |
| `m13-7-5-browser.integration.test.ts` **scenario A** (isolated, `-t "scenario A"`) | **PASS** (1/1; 5 skipped) — **2026-11-05** |
| `m13-7-5-browser.integration.test.ts` (full 6/6) | **Deferred** — not executed |
| `console-browser-smoke` / combined `verify:branch --profile=integration` | **Deferred** — not executed |
| `pnpm verify:branch` (fast profile) | **BLOCKED** (exit 2) — static/unit **PASS**; browser obligations **NOT RUN** |
| `pnpm verify:branch --profile=integration` | **Deferred** — not executed |
| `acceptance:m16-registry` live smoke (**`m17-114`**) | **Deferred** — not executed |
| `docs-link-check` after doc authoring | **PASS** (via verify:branch) |
| Cross-repo PR merge CI (osva **#94**, examples **#12–#13**, connectors **#14**, adapters **#11**) | **PASS** on merge commits (GitHub Actions) |
| M19 closeout doc pass (`docs-link-check`, `git diff --check`) | See [`M19_CLOSEOUT_SUMMARY.md`](M19_CLOSEOUT_SUMMARY.md) §7 |
| Git commit/push (this closeout branch) | **NOT PERFORMED** (per task constraints) |

---

## 10. Related documentation

| Document | Role |
| --- | --- |
| [`M19_CLOSEOUT_SUMMARY.md`](M19_CLOSEOUT_SUMMARY.md) | Publication order and release gates |
| [`M17_ACCEPTANCE_SUMMARY.md`](M17_ACCEPTANCE_SUMMARY.md) | External journey evidence |
| [`M18_CLOSEOUT_SUMMARY.md`](M18_CLOSEOUT_SUMMARY.md) | Console UX complete |
| [`../architecture/EXTERNAL_ECOSYSTEM_COMPATIBILITY.md`](../architecture/EXTERNAL_ECOSYSTEM_COMPATIBILITY.md) | Boundary rules (update in M19.1) |
| [`../engineering/CONNECTOR_TOOL_GATEWAY_ACCEPTANCE.md`](../engineering/CONNECTOR_TOOL_GATEWAY_ACCEPTANCE.md) | MCP stdio / ToolGateway acceptance |
| [`../release/M16_EXTERNAL_CONSUMER_ACCEPTANCE.md`](../release/M16_EXTERNAL_CONSUMER_ACCEPTANCE.md) | Registry harness (**m16-111**) |
