# RC.4 clean-room verification (maintainer checklist)

Security release candidate **`1.1.0-rc.4`** builds on PR **#56** (Zod remediation, capability collection bounds, Console verification reliability) and PR **#58** (dependency vulnerability remediation). Published **`1.1.0-rc.2`** M10.4 gates remain historical record in [`M10_4_PUBLISHED_ARTIFACT_ACCEPTANCE.md`](M10_4_PUBLISHED_ARTIFACT_ACCEPTANCE.md). **`1.1.0-rc.3`** was prepared in repository but **superseded by RC.4** for npm publication planning.

**Repository baseline (M15.1):** tag **`v1.1.0-rc.4`** → commit **`cd38eea46b8ee44bb099ccf307818cfcd348f50b`** (`fix(security): remediate RC4 dependency vulnerabilities (#58)`). Prior RC.4 content commits: **`2b316b910898002c6edbd9241ed51cd03e9e7c25`** (#57 version bump), **`e7dbc2349b4c9661f9922fa16a087dd446f37366`** (#56 security fixes).

### RC.4 preparation and publication (security release)

| Item | Status | Evidence |
| --- | --- | --- |
| Bump aligned **`1.1.0-rc.4`** on five npm packages + `VERSION` + Helm + Python | **Complete** | PR **#57** merged **`2026-10-26`**; `pnpm release:version:check` **PASS** (`1.1.0-rc.4`) on reconciliation **`2026-10-27`** |
| Zod **4.6.7** catalog + bounded collection validation (GHSA-mrhx-c7xc-m3w5) | **Complete** | PR **#56** merged to **`main`** |
| RC.4 dependency vulnerability remediation | **Complete** | PR **#58** merged **`2026-10-27`**; HEAD = tag target |
| Packed `@osva-ai/contracts` artifact blob root export regression | **Complete** (from RC.3) | `release-readiness` **`packages`** job on **`cd38eea`** |
| Git tag **`v1.1.0-rc.4`** | **Complete** | `git rev-list -n 1 v1.1.0-rc.4` → **`cd38eea46b8ee44bb099ccf307818cfcd348f50b`** |
| GitHub prerelease **`v1.1.0-rc.4`** | **Complete** | Published **`2026-10-27T09:54:36Z`** |
| npm five packages at **`1.1.0-rc.4`**; dist-tag **`rc`** | **Complete** | `npm view @osva-ai/{contracts,runtime-protocol,sdk,cli,connector-sdk}@rc version` → **`1.1.0-rc.4`** (reconciliation **`2026-10-27`**) |
| GitHub **`Release readiness`** on publish commit **`cd38eea`** | **Complete** | Run **`40479668476`**: **`verify-core`**, **`packages`**, **`oci-compose-helm`**, **`kind`** — all **success** |
| PyPI **`osva-sdk==1.1.0rc4`** publish | **Pending** | PyPI JSON index lists **`1.1.0rc1`** and **`1.1.0rc2`** only (reconciliation **`2026-10-28`** M15.5) |
| GHCR **`ghcr.io/osva-ai/osva:1.1.0-rc.4`** | **Pending** | GHCR package versions show latest container tag **`1.1.0-rc.2`** (reconciliation **`2026-10-28`** M15.5) |
| M10.4-style published-registry acceptance for **`1.1.0-rc.4`** | **Pending** | No RC.4 equivalent to M10.4E isolated Compose + registry-only CLI/SDK replay |

## Prior RC gate record

| Gate | Status |
| --- | --- |
| GitHub CI on security merge commit `e7dbc2349b4c9661f9922fa16a087dd446f37366` (#56) | **Passed** (required checks before merge) |
| **`1.1.0-rc.2`** M10.4 published-registry acceptance | **Complete** (see M10.4 doc) |

## Required checks before additional publish channels (PyPI / GHCR / M10.4E replay)

1. **`pnpm release:version:check`** — VERSION, npm, Python, Helm alignment.
2. **`node scripts/release/npm-pack-smoke.mjs`** — packed manifests, Zod resolution, no `workspace:`/`catalog:` leaks.
3. **`pnpm release:licenses`** — third-party inventory includes **zod@4.6.7**.
4. **GitHub `Release readiness` workflow** — all jobs green on the target commit (already **passed** for **`cd38eea`**).
5. **Focused local verification** (maintainer): contracts + runtime-protocol + SDK tests; release script tests.
6. **Optional full clean gate:** `pnpm verify:ci:clean` on disposable environment before tag (not required to re-prove #56/#58 if unchanged after version bump only).

## npm publication order

Publish in dependency order (same as release-readiness pack smoke):

1. `@osva-ai/contracts`
2. `@osva-ai/runtime-protocol`
3. `@osva-ai/sdk`
4. `@osva-ai/cli`
5. `@osva-ai/connector-sdk`

Use dist-tag **`rc`**; do **not** move npm **`latest`** from **`1.0.0`** without maintainer policy.

## osva-adapters handoff

After registry verification, bump osva-adapters to **`@osva-ai/contracts@1.1.0-rc.4`** (and aligned packages if used) and run adapter CI against the published tarball versions.

## Supply-chain (optional, operator-provided)

Document manually if run; absence does not block RC.4 npm publication:

| Check | Tooling |
|-------|---------|
| Container CVE scan | Trivy/Grype against target GHCR tag (if OCI republished) |
| SBOM | syft or pnpm SBOM exporters |
| npm provenance | npm trusted publishing / OIDC (if configured on packages) |

In-repo automation: **secrets scan**, **license inventory**, **pack/install smokes** (release-readiness `packages` job).
