# M19 Ecosystem Readiness Audit

**Audit date:** 2026-11-05 (initial) · **Reconciled:** 2026-11-06 (publication + acceptance evidence)
**Auditor context:** M19.1–M19.6 complete across four repositories; osva **`main`** @ **`cb46caf`** (M13.7.5 sync fix on **`#96`**).
**Closeout record:** [`M19_CLOSEOUT_SUMMARY.md`](M19_CLOSEOUT_SUMMARY.md)
**Verification policy:** [`../engineering/DEVELOPMENT_GATES.md`](../engineering/DEVELOPMENT_GATES.md) · [`../engineering/BRANCH_VERIFICATION.md`](../engineering/BRANCH_VERIFICATION.md)

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
| **M19.1** | **Complete** | Cross-repo COMPATIBILITY aligned to platform **1.1.1** + npm **1.1.4** |
| **M19.2** | **Complete** | Example 19 npm-only harness — osva-examples PR **#12** |
| **M19.3** | **Complete** | **8** connector npm releases with **`connector-sdk@1.1.4`** — [M19_PUBLICATION_RECORD](https://github.com/Osva-AI/osva-connectors/blob/main/docs/M19_PUBLICATION_RECORD.md) |
| **M19.4** | **Complete** | Dual-track examples (01–18 **1.0.0**, 19 **1.1.4**) |
| **M19.5** | **Complete** | Adapters **`0.1.2`** + sidecar **`0.1.0`** on npm; **`latest`** promoted for artifact adapters |
| **M19.6** | **Complete** | **`m17-114`** live registry **38/38**; M13.7.5 browser **6/6**; PR **#96** sync fix |

---

## 1. Supported OSVA release lines (canonical)

| Surface | Version | Registry check (2026-11-06) |
| --- | --- | --- |
| Platform (`VERSION`, GHCR/PyPI/Helm) | **1.1.1** | In-repo file |
| npm `@osva-ai/contracts`, `runtime-protocol`, `sdk`, `connector-sdk`, `cli` | **1.1.4** | **`npm view` → 1.1.4** |
| npm M19 connector line (8 packages) | See closeout §6 | **Published** at M19 semver |
| npm M19 adapter line (3 packages) | **0.1.2** / **0.1.0** | **Published** |
| Python `osva-sdk` (PyPI) | **1.1.1** | M17 record |

**Support classes**

| Class | Meaning |
| --- | --- |
| **Current supported** | Platform **1.1.1** + npm **`@osva-ai/*@1.1.4`** + M19 published connectors/adapters |
| **Legacy registry-verified** | npm **1.1.2** on platform **1.1.1** — target **`m16-111`** |
| **Legacy compatibility** | osva-examples **1.0.0** track (Examples **01–18**) |
| **Source-only connectors** | **7 / 15** connectors not on npm — out of M19 publication scope |
| **Acceptance deferred (post-M19)** | Full **`verify:branch --profile=integration`** Turbo on doc-only branches; A1.4/A2.5 Docker adapter re-run |

---

## 2. osva-connectors inventory (15 packages)

Status legend:

- **Published** — `npm view @osva-ai/connector-<name> version` succeeds at M19 semver
- **Source-only** — not on npm
- **Externally verified** — OSVA ToolGateway CI or operator acceptance (subset of connectors)

| Package | Ver. (npm latest) | SDK on published tarball | Published | M19 notes |
| --- | --- | --- | --- | --- |
| `@osva-ai/connector-github` | **0.3.1** | **1.1.4** | **Yes** | Realignment complete |
| `@osva-ai/connector-postgres` | **0.1.1** | **1.1.4** | **Yes** | Realignment complete |
| `@osva-ai/connector-shopify` | **0.1.1** | **1.1.4** | **Yes** | Realignment complete |
| `@osva-ai/connector-ga4` | **0.1.1** | **1.1.4** | **Yes** | Realignment complete |
| `@osva-ai/connector-npm` | **0.1.1** | **1.1.4** | **Yes** | Realignment complete |
| `@osva-ai/connector-slack` | **0.1.0** | **1.1.4** | **Yes** | Wave 1 |
| `@osva-ai/connector-stripe` | **0.1.0** | **1.1.4** | **Yes** | Wave 1 |
| `@osva-ai/connector-hubspot` | **0.1.0** | **1.1.4** | **Yes** | Wave 1 |
| `@osva-ai/connector-google-ads` | — | — | **No** | Source-only |
| `@osva-ai/connector-google-drive` | — | — | **No** | Source-only |
| `@osva-ai/connector-google-sheets` | — | — | **No** | Source-only |
| `@osva-ai/connector-gsc` | — | — | **No** | Source-only |
| `@osva-ai/connector-klaviyo` | — | — | **No** | Source-only |
| `@osva-ai/connector-meta-ads` | — | — | **No** | Source-only |
| `@osva-ai/connector-whatsapp` | — | — | **No** | Source-only |

**Publication summary:** **8 / 15** on npm at M19-aligned versions. Immutable older semver lines remain on the registry with legacy SDK pins — prefer **`latest`** coordinates in [compatibility.md](https://github.com/Osva-AI/osva-connectors/blob/main/docs/compatibility.md).

**Trusted publishing:** GitHub Actions environment **`npm`**, workflow **`npm-release.yml`**.

---

## 3. osva-examples inventory (19 examples)

Dual tracks unchanged — see [COMPATIBILITY.md](https://github.com/Osva-AI/osva-examples/blob/main/COMPATIBILITY.md).

Example **19** pins **`@osva-ai/sdk` / `contracts` / `connector-sdk` @ 1.1.4** and **`connector-npm@0.1.0`** by M19.4 policy; registry **`0.1.1`** available for new installs with SDK **1.1.4**.

---

## 4. osva-adapters inventory (3 packages)

| Package | npm | Declared deps | M19 status |
| --- | --- | --- | --- |
| `@osva-ai/adapter-artifact-memory` | **0.1.2** (`latest`, `rc`) | **`@osva-ai/contracts@1.1.4`** | **Published** |
| `@osva-ai/adapter-artifact-azure` | **0.1.2** (`latest`, `rc`) | **`@osva-ai/contracts@1.1.4`** | **Published** |
| `@osva-ai/runtime-cli-sidecar` | **0.1.0** | **`contracts` / `runtime-protocol` / `sdk` @1.1.4** | **Published** |

Post-publish workflow uses bounded npm registry polling (see osva-adapters **`publish-package.yml`**).

---

## 5. osva-site

Out of scope for agent/connector npm journeys (unchanged).

---

## 6. Compatibility gaps (reconciled)

| # | Gap | Status |
| --- | --- | --- |
| G1 | Published connector tarballs on legacy SDK deps | **Closed** — realignment semver on npm |
| G2 | Wave 1 connectors unpublished | **Closed** — slack/stripe/hubspot **0.1.0** |
| G3 | Dual-track examples undocumented | **Closed (M19.4)** |
| G4 | Adapters / sidecar not on npm **`latest`** | **Closed** — **0.1.2** + sidecar **0.1.0** |
| G5 | MCP stdio operator opt-in | **Open (by design)** — documented; not default |
| G6 | Registry harness default | **Closed** — **`m17-114`** |
| G7 | M13.7.5 combined integration timeout | **Closed** — **6/6** browser + PR **#96** |

---

## 7. First external developer acceptance journey

M17.8 / M17.9 evidence remains valid. M19 adds:

- **11-package** npm ecosystem publication with clean install proof
- Live registry **`m17-114`**: **38/38 PASS**
- Example 19 external-consumer harness (merged); optional re-run post-publish

---

## 8. M19.1–M19.6 closeout status

All slices **complete (scoped)** per [`M19_CLOSEOUT_SUMMARY.md`](M19_CLOSEOUT_SUMMARY.md).

---

## 9. Audit verification performed

| Check | Result |
| --- | --- |
| Package counts (15 / 19 / 3) | **Confirmed** |
| npm registry spot-check M19 matrix | **PASS** (**2026-11-06** closeout pass) |
| Live **`m17-114`** registry acceptance | **PASS** **38/38** (operator; not re-run in doc PR) |
| M13.7.5 browser **6/6** + helpers **4/4** | **PASS** (operator; not re-run in doc PR) |
| `node --test scripts/acceptance/r11-registry-only/test/targets.test.mjs` | **PASS** (8/8) — prior record |
| Combined `verify:branch --profile=integration` Turbo | **NOT_RUN** on doc-only branch |
| Cross-repo M19 implementation PR CI | **PASS** (historical merge commits) |
| M19 final closeout doc pass | See closeout summary §12 |

---

## 10. Related documentation

| Document | Role |
| --- | --- |
| [`M19_CLOSEOUT_SUMMARY.md`](M19_CLOSEOUT_SUMMARY.md) | Publication inventory and acceptance gates |
| [`M17_ACCEPTANCE_SUMMARY.md`](M17_ACCEPTANCE_SUMMARY.md) | External journey evidence |
| [`M18_CLOSEOUT_SUMMARY.md`](M18_CLOSEOUT_SUMMARY.md) | Console UX complete |
| [`../release/COMPATIBILITY.md`](../release/COMPATIBILITY.md) | Platform/npm policy |
