# RC.4 clean-room verification (maintainer checklist)

Security release candidate **`1.1.0-rc.4`** builds on PR **#56** (Zod remediation, capability collection bounds, Console verification reliability). Published **`1.1.0-rc.2`** M10.4 gates remain historical record in [`M10_4_PUBLISHED_ARTIFACT_ACCEPTANCE.md`](M10_4_PUBLISHED_ARTIFACT_ACCEPTANCE.md). **`1.1.0-rc.3`** was prepared in repository but **superseded by RC.4** for npm publication planning.

### RC.4 preparation (security release)

| Item | Status |
| --- | --- |
| Bump aligned **`1.1.0-rc.4`** on five npm packages + `VERSION` + Helm + Python | **Prepared** (local branch) |
| Zod **4.6.7** catalog + bounded collection validation (GHSA-mrhx-c7xc-m3w5) | **Merged** (#56) |
| Packed `@osva-ai/contracts` artifact blob root export regression | **Present** (from RC.3) |
| Maintainer tag / npm **`rc`** dist-tag publish | **Pending** |
| GitHub `release-readiness` on publish commit | **Pending** |
| M10.4-style published-registry acceptance for **`1.1.0-rc.4`** | **Pending** |

## Prior RC gate record

| Gate | Status |
| --- | --- |
| GitHub CI on security merge commit `e7dbc2349b4c9661f9922fa16a087dd446f37366` (#56) | **Passed** (required checks before merge) |
| **`1.1.0-rc.2`** M10.4 published-registry acceptance | **Complete** (see M10.4 doc) |

## Required checks before publish (RC.4)

1. **`pnpm release:version:check`** — VERSION, npm, Python, Helm alignment.
2. **`node scripts/release/npm-pack-smoke.mjs`** — packed manifests, Zod resolution, no `workspace:`/`catalog:` leaks.
3. **`pnpm release:licenses`** — third-party inventory includes **zod@4.6.7**.
4. **GitHub `release-readiness` workflow** — all jobs green on the release PR merge commit.
5. **Focused local verification** (maintainer): contracts + runtime-protocol + SDK tests; release script tests.
6. **Optional full clean gate:** `pnpm verify:ci:clean` on disposable environment before tag (not required to re-prove #56 if unchanged after version bump only).

## npm publication order

Publish in dependency order (same as release-readiness pack smoke):

1. `@osva-ai/contracts`
2. `@osva-ai/runtime-protocol`
3. `@osva-ai/sdk`
4. `@osva-ai/connector-sdk`
5. `@osva-ai/cli`

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
