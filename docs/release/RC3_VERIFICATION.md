# RC.3 clean-room verification (maintainer checklist)

Prerequisites after RC.2 lands. **Do not publish** until every required gate passes on the **`1.1.0-rc.1`** commit.

## Required gates

1. **`pnpm verify:ci:clean`** — authoritative clean verification (disposable environment).
2. **GitHub `release-readiness` workflow** — all jobs green on the RC commit (`verify-core`, `packages`, `oci-compose-helm`, `kind`).
3. **`pnpm release:acceptance`** with `OSVA_KIND_ACCEPTANCE=true` and `OSVA_IMAGE=osva:1.1.0-rc.1` (Linux recommended).
4. **Version alignment:** `pnpm release:version:check`; `node --test scripts/release/release-readiness-version.test.mjs`.
5. **Upgrade drill (disposable DB):** database at **`0022`** snapshot → migrate **`0023`** → integrity CLI → smoke `/v1` run.

## Optional M9.7 replay

```bash
pnpm acceptance:m9-7b -- --group=b2
pnpm acceptance:m9-7b -- --group=b3
pnpm acceptance:m9-7b -- --group=b4
```

Re-run only when validating behavioral parity after RC.2; historical M9.7 evidence remains on commit `65aae39` at VERSION `1.0.0`.

## Supply-chain (not automated in RC.2)

Document results manually if run; absence does not block RC.3 code gates:

| Check | Tooling (operator-provided) |
|-------|-----------------------------|
| Container CVE scan | Trivy/Grype against `osva:1.1.0-rc.1` |
| SBOM | syft or `pnpm` SBOM exporters |
| npm/PyPI provenance | npm provenance / PyPI attestations (optional) |
| Release checksums | `sha256sum` on helm chart tarball, wheels, tgz |

In-repo automation today: **secrets scan**, **license inventory**, **pack/install smokes**.

## Publish authorization (separate approval)

Only after RC.3 sign-off:

- Git tag `v1.1.0-rc.1` + GitHub Release notes from `CHANGELOG.md`
- npm publish with dist-tag **`rc`**
- PyPI upload **`1.1.0-rc.1`**
- GHCR push `osva:1.1.0-rc.1` (do not move `:latest` to RC without policy)
