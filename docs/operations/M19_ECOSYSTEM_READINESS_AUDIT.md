# M19 Ecosystem Readiness Audit

**Audit date:** 2026-11-05 (registry re-verified **2026-11-05** on branch `feat/m19-core-compat-integration`)
**Auditor context:** M19.1 + M19.6 core scope; prior baseline **`origin/main`** @ **`b3c20e3`**.
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

### M19 slice status (osva repository)

| Slice | Status in osva | Cross-repo |
| --- | --- | --- |
| **M19.1** | **Pending cross-repository closeout** — osva matrices refreshed; sibling `COMPATIBILITY.md` files still lag | osva-connectors, osva-examples, osva-adapters |
| **M19.2** | **Complete** — external-consumer harness merged in [osva-examples PR #12](https://github.com/Osva-AI/osva-examples/pull/12) | — |
| **M19.6** | **Complete (osva scope)** — registry target **`m17-114`**, M13.7.5 API-first run polling, MCP stdio doc cross-links; combined **`profile=integration`** re-run **deferred** | — |

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
| **Unverified / repo-only** | Unpublished connectors (10/15), **`runtime-cli-sidecar`**, Example 19 harness re-run from osva CI (M19.2 merged; not re-executed in this pass) |
| **Future (M19.3–M19.5)** | Connector SDK **1.1.4** alignment wave, examples **1.1.x** track, adapter/sidecar publication |

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
| `@osva-ai/connector-github` | 0.3.0 | **1.1.0-rc.2** | **Yes** | architecture, mcp, fake provider | GitHub PAT / OAuth | Mutating tools gated; live mode guards |
| `@osva-ai/connector-postgres` | 0.1.0 | **1.1.0-rc.2** | **Yes** | architecture, mcp, fake provider | DB URL via secrets | Read-only SQL tools |
| `@osva-ai/connector-shopify` | 0.1.0 | **1.1.0-rc.2** | **Yes** | architecture, mcp, fake provider | Shopify access token | Read-only product/order tools |
| `@osva-ai/connector-ga4` | 0.1.0 | **1.1.0-rc.2** | **Yes** | architecture, mcp, fake provider | Google service account | Read-only analytics |
| `@osva-ai/connector-npm` | 0.1.0 | **1.1.3** | **Yes** | architecture, mcp, registry client tests | Public registry (no secret) | **Only connector aligned to post-rc SDK**; M17 real-world path |
| `@osva-ai/connector-google-ads` | 0.1.0 | **1.1.0-rc.2** | **No** | Same pattern as peers | Google Ads OAuth | Not installable from npm |
| `@osva-ai/connector-google-drive` | 0.1.0 | **1.1.0-rc.2** | **No** | — | Google OAuth | Not on registry |
| `@osva-ai/connector-google-sheets` | 0.1.0 | **1.1.0-rc.2** | **No** | — | Google OAuth | Not on registry |
| `@osva-ai/connector-gsc` | 0.1.0 | **1.1.0-rc.2** | **No** | — | Search Console OAuth | Not on registry |
| `@osva-ai/connector-hubspot` | 0.1.0 | **1.1.0-rc.2** | **No** | — | HubSpot token | Not on registry |
| `@osva-ai/connector-klaviyo` | 0.1.0 | **1.1.0-rc.2** | **No** | — | Klaviyo API key | Not on registry |
| `@osva-ai/connector-meta-ads` | 0.1.0 | **1.1.0-rc.2** | **No** | — | Meta app secret + token | Not on registry |
| `@osva-ai/connector-slack` | 0.1.0 | **1.1.0-rc.2** | **No** | — | Slack bot token | Not on registry |
| `@osva-ai/connector-stripe` | 0.1.0 | **1.1.0-rc.2** | **No** | — | Stripe secret key | Not on registry |
| `@osva-ai/connector-whatsapp` | 0.1.0 | **1.1.0-rc.2** | **No** | — | Meta WhatsApp token | Not on registry |

**Publication summary:** **5 / 15** published on npm (**github** 0.3.0, **postgres**, **shopify**, **ga4**, **connector-npm**). **10 / 15** implemented in repo but **not** on registry (`npm view` **2026-11-05**).

**Docs drift:** `osva-connectors/docs/compatibility.md` still cites **`1.1.0-rc.2`** SDK baseline (C0.1 table); **`connector-npm`** exception documented there only.

**OSVA cross-repo evidence:** osva CI job **m12-3-acceptance** / **github-connector-integration** (pinned connector SHA) proves **GitHub** (+ postgres in M12.4 history) against in-repo stack — **not** automatic proof for unpublished connectors.

---

## 3. osva-examples inventory (19 examples)

Repo-wide [`COMPATIBILITY.md`](https://github.com/Osva-AI/osva-examples/blob/main/COMPATIBILITY.md) targets **OSVA 1.0.0** / **`@osva-ai/sdk@1.0.0`**.

| Example | `@osva-ai/sdk` pin | OSVA line | Tests (repo) | Published consumer proof |
| --- | --- | --- | --- | --- |
| **01–18** | **1.0.0** | 1.0.x | Per-example vitest (smoke, agent, bootstrap patterns) | **Not verified** in this audit |
| **19-research-report-agent** | **`@osva-ai/sdk` / `contracts` / `connector-sdk` @ 1.1.4** | **1.1.x** | `test/*.test.ts` (agent, connector, bootstrap, mcp-http, model-profile) | **M17.8** operator workflow; **M19.2** external-consumer harness ([PR #12](https://github.com/Osva-AI/osva-examples/pull/12)) |

**Verified (2026-11-05):** `examples/19-research-report-agent/package.json` on **osva-examples `main`** pins **`@osva-ai/sdk@1.1.4`**, **`@osva-ai/contracts@1.1.4`**, **`@osva-ai/connector-sdk@1.1.4`**, **`@osva-ai/connector-npm@0.1.0`**.

**Gap:** Examples **01–18** remain on **`@osva-ai/sdk@1.0.0`** per repo-wide [`COMPATIBILITY.md`](https://github.com/Osva-AI/osva-examples/blob/main/COMPATIBILITY.md). Example **19** is the **current-line** reference; root examples docs still describe the **1.0.0** legacy track (M19.4).

**No** dedicated integration test directory under example 19 that runs against a live OSVA stack from a clean external install — validation is **unit-level** + **M17 operator** acceptance.

---

## 4. osva-adapters inventory (3 packages)

| Package | Ver. (repo) | npm published | Dependency pins | Registration | Test / acceptance evidence |
| --- | --- | --- | --- | --- | --- |
| `@osva-ai/adapter-artifact-memory` | **0.1.1** | **Yes** (`0.1.0`, **`0.1.1`**) | `@osva-ai/contracts@1.1.0-rc.4` | `OSVA_ARTIFACT_BLOB_STORE_REGISTER_MODULE` | A1.1 verify scripts; A1.4 compose harness (repo) |
| `@osva-ai/adapter-artifact-azure` | **0.1.1** | **Yes** (`0.1.0`, **`0.1.1`**) | `@osva-ai/contracts@1.1.0-rc.4` + Azure SDK | Same registered driver pattern | A1.2 docs; A1.4 cross-process acceptance |
| `@osva-ai/runtime-cli-sidecar` | **0.1.0** | **No** | `@osva-ai/contracts`, `runtime-protocol`, `sdk` **@1.1.0-rc.4** | Runtime Protocol V1 sidecar (REMOTE_HTTP) | Hermetic CLI fixtures in repo; **not** npm consumer tested |

**Blockers:**

- **rc.4 contract pins** vs public **1.1.4** npm — consumers mixing published platform SDK with adapters need explicit compatibility matrix (not silently upgraded).
- **Sidecar unpublished** — external REMOTE_HTTP CLI agent path requires git checkout or future npm publish.
- **Registration** requires operator env (`OSVA_ARTIFACT_STORAGE_DRIVER=registered`) and image install — not Console-clickable.

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
| G1 | **14/15 connectors** on **`connector-sdk@1.1.0-rc.2`** (**connector-npm** on **1.1.3** only) | semver / transitive `@osva-ai/contracts` mismatch vs **1.1.4** platform SDK |
| G2 | **10 connectors unpublished** | External developers cannot `npm install` those tools |
| G3 | **osva-examples** repo-wide baseline **1.0.0** while Example **19** is on **`@osva-ai/*@1.1.4`** | Root `COMPATIBILITY.md` still legacy; dual-track docs (M19.4) |
| G4 | **osva-adapters** pin **1.1.0-rc.4**; sidecar **not on npm** | Artifact + CLI runtime paths require monorepo/checkout knowledge |
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

**Conclusion:** **M19.2** closed the npm-only Example 19 harness gap (PR **#12**). Further work is **M19.4** (examples **01–18** / root `COMPATIBILITY.md`) and sibling connector/adapter doc alignment — **not** a full M17.8 workflow replay unless platform coordinates change.

---

## 8. Prioritized M19.1–M19.6 execution plan

Adjusted to evidence above; **no version bumps** in this audit commit unless a slice explicitly authorizes them.

| Slice | Objective | Primary repo | Depends on | Exit criteria |
| --- | --- | --- | --- | --- |
| **M19.1** | **Ecosystem truth docs** — refresh compatibility matrices (connectors, examples, adapters) against **1.1.4** / platform **1.1.1** | osva + siblings | — | **Pending cross-repository closeout** until sibling repos refresh `COMPATIBILITY.md` |
| **M19.2** | **Example 19 external-consumer harness** — clean install script, no monorepo imports; records JSON artifact | osva-examples + osva CI hook | M19.1 | **Done** — [osva-examples PR #12](https://github.com/Osva-AI/osva-examples/pull/12) |
| **M19.3** | **Connector SDK alignment + publication wave 1** — align pins to **1.1.4**; publish **high-demand** unpublished connectors (prioritize slack/stripe/hubspot per product) | osva-connectors | M19.1 | `npm view` for chosen set; connector-sdk **1.1.4** in repo |
| **M19.4** | **Examples 1.1.x track** — either bump **01–18** or document “legacy 1.0 only” + add **1.1.x** migration guide | osva-examples | M19.1 | COMPATIBILITY.md reflects dual track or upgraded pins |
| **M19.5** | **Adapters + sidecar distribution** — publish **`runtime-cli-sidecar`** or document supported install path; bump adapter contract pins to **1.1.4** | osva-adapters | M19.1 | npm consumer smoke for artifact adapters; sidecar strategy decided |
| **M19.6** | **Integration hardening** — **`m17-114`** registry target; M13.7.5 combined-timeout fix; MCP stdio operator cross-links | osva | M18.10 exception | Focused tests + optional **`verify:branch --profile=integration`** re-run |

**Recommended next slice:** **M19.3** / **M19.4** (connector publication/SDK alignment and examples dual-track docs). **M19.2** is **complete**.

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
| Git commit/push | **NOT PERFORMED** |

---

## 10. Related documentation

| Document | Role |
| --- | --- |
| [`M17_ACCEPTANCE_SUMMARY.md`](M17_ACCEPTANCE_SUMMARY.md) | External journey evidence |
| [`M18_CLOSEOUT_SUMMARY.md`](M18_CLOSEOUT_SUMMARY.md) | Console UX complete |
| [`../architecture/EXTERNAL_ECOSYSTEM_COMPATIBILITY.md`](../architecture/EXTERNAL_ECOSYSTEM_COMPATIBILITY.md) | Boundary rules (update in M19.1) |
| [`../engineering/CONNECTOR_TOOL_GATEWAY_ACCEPTANCE.md`](../engineering/CONNECTOR_TOOL_GATEWAY_ACCEPTANCE.md) | MCP stdio / ToolGateway acceptance |
| [`../release/M16_EXTERNAL_CONSUMER_ACCEPTANCE.md`](../release/M16_EXTERNAL_CONSUMER_ACCEPTANCE.md) | Registry harness (**m16-111**) |
