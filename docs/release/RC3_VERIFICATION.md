# RC.3 clean-room verification (maintainer checklist)

**M10.4 for RC2 is complete** — see [`M10_4_PUBLISHED_ARTIFACT_ACCEPTANCE.md`](M10_4_PUBLISHED_ARTIFACT_ACCEPTANCE.md) and [`RELEASE_CANDIDATE_INVENTORY.json`](RELEASE_CANDIDATE_INVENTORY.json) (`pendingReleaseGates`: empty). Do not treat RC2 as GA.

This document is a **future maintainer checklist** for the next RC or GA line (for example RC.3 / GA readiness on a **new** version bump). It does **not** list pending gates for published **`1.1.0-rc.2`**.

## RC2 / M10.4 gate record (complete)

| Gate | Status |
| --- | --- |
| GitHub CI on release commit `6bc970f03d364da35aaeb1fe8aaaa3218986b27f` (merged RC2 PR) | **Passed** (required checks before merge/publication) |
| `release-readiness` workflow on release commit (`verify-core`, `packages`, `oci-compose-helm`, `kind`) | **Passed** before publication |
| Maintainer tag **`v1.1.0-rc.2`**, GitHub Release, npm/PyPI/GHCR publish (M10.4D) | **Done** |
| M10.4C local RC2 distribution acceptance | **Passed** |
| M10.4E published-registry acceptance | **Passed** |
| **`pnpm verify:ci:clean` local rerun during M10.4F closeout** | **Not rerun** — release content had already passed required CI/release-readiness; published artifacts passed M10.4E |

## Optional checks for a future version line

Use when cutting a **new** RC or GA after a version bump (not republishing RC2):

1. **`pnpm verify:ci:clean`** — authoritative clean verification (disposable environment).
2. **GitHub `release-readiness` workflow** — all jobs green on the target commit.
3. **`pnpm release:acceptance`** with `OSVA_KIND_ACCEPTANCE=true` and the target `OSVA_IMAGE` (Linux recommended).
4. **Version alignment:** `pnpm release:version:check`; `node --test scripts/release/release-readiness-version.test.mjs`.
5. **Upgrade drill (disposable DB):** database at **`0022`** snapshot → migrate **`0023`** → integrity CLI → smoke `/v1` run.
6. **Published-artifact acceptance** — isolated registry install path for the new version (M10.4-style).

## Optional M9.7 replay

```bash
pnpm acceptance:m9-7b -- --group=b2
pnpm acceptance:m9-7b -- --group=b3
pnpm acceptance:m9-7b -- --group=b4
```

Re-run only when validating behavioral parity after a release; historical M9.7 evidence remains on commit **`65aae39`** at VERSION **`1.0.0`**.

## Supply-chain (not automated in RC.2)

Document results manually if run; absence does not block publication of a future line:

| Check | Tooling (operator-provided) |
|-------|-----------------------------|
| Container CVE scan | Trivy/Grype against the target GHCR tag |
| SBOM | syft or `pnpm` SBOM exporters |
| npm/PyPI provenance | npm provenance / PyPI attestations (optional) |
| Release checksums | `sha256sum` on helm chart tarball, wheels, tgz |

In-repo automation today: **secrets scan**, **license inventory**, **pack/install smokes**.

## RC.2 publication record (complete)

Maintainer publication for **`v1.1.0-rc.2`** is **done** (M10.4D). Published artifacts:

- Git tag **`v1.1.0-rc.2`** + GitHub Release (do **not** replace or mutate **`v1.1.0-rc.1`** release assets)
- npm **`1.1.0-rc.2`** with dist-tag **`rc`** ( **`latest`** remains **`1.0.0`** )
- PyPI **`osva-sdk==1.1.0rc2`** (PEP 440)
- GHCR **`ghcr.io/osva-ai/osva:1.1.0-rc.2`** ( **`:latest`** not moved to RC without policy )

Future RC or GA releases require a **new** version bump, tag, and publish cycle — not republishing RC2.
