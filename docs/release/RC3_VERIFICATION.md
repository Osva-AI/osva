# RC.3 clean-room verification (maintainer checklist)

Prerequisites after **RC.2 preparation** lands in the repository. **Do not publish** until every required gate passes on the **RC.2 commit** (read root `VERSION`).

## Required gates

1. **`pnpm verify:ci:clean`** — authoritative clean verification (disposable environment).
2. **GitHub `release-readiness` workflow** — all jobs green on the RC commit (`verify-core`, `packages`, `oci-compose-helm`, `kind`).
3. **`pnpm release:acceptance`** with `OSVA_KIND_ACCEPTANCE=true` and `OSVA_IMAGE=osva:1.1.0-rc.2` (Linux recommended).
4. **Version alignment:** `pnpm release:version:check`; `node --test scripts/release/release-readiness-version.test.mjs`.
5. **Upgrade drill (disposable DB):** database at **`0022`** snapshot → migrate **`0023`** → integrity CLI → smoke `/v1` run.
6. **Published-artifact acceptance (M10.4):** npm/PyPI/GHCR **`1.1.0-rc.2`** after publish — isolated Compose with `ghcr.io/osva-ai/osva:1.1.0-rc.2`, npm CLI golden path (not source-built CLI).

## Optional M9.7 replay

```bash
pnpm acceptance:m9-7b -- --group=b2
pnpm acceptance:m9-7b -- --group=b3
pnpm acceptance:m9-7b -- --group=b4
```

Re-run only when validating behavioral parity after RC.2; historical M9.7 evidence remains on commit **`65aae39`** at VERSION **`1.0.0`**.

## Supply-chain (not automated in RC.2)

Document results manually if run; absence does not block RC.3 code gates:

| Check | Tooling (operator-provided) |
|-------|-----------------------------|
| Container CVE scan | Trivy/Grype against `ghcr.io/osva-ai/osva:1.1.0-rc.2` |
| SBOM | syft or `pnpm` SBOM exporters |
| npm/PyPI provenance | npm provenance / PyPI attestations (optional) |
| Release checksums | `sha256sum` on helm chart tarball, wheels, tgz |

In-repo automation today: **secrets scan**, **license inventory**, **pack/install smokes**.

## Publish authorization (separate approval)

Only after RC.3 sign-off:

- Git tag **`v1.1.0-rc.2`** + GitHub Release notes from `CHANGELOG.md` (do **not** replace or mutate **`v1.1.0-rc.1`** release assets)
- npm publish **`1.1.0-rc.2`** with dist-tag **`rc`**
- PyPI upload **`osva-sdk==1.1.0rc2`** (PEP 440)
- GHCR push **`ghcr.io/osva-ai/osva:1.1.0-rc.2`** (do not move `:latest` to RC without policy)

Verify **`@osva-ai/cli`** pack includes **`templates/`**, **`ajv`**, and M10.2 commands before npm publish (`node scripts/release/npm-pack-smoke.mjs`, `pnpm acceptance:m10-2e:pack`).
