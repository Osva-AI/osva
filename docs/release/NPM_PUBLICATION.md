# npm publication (public `@osva-ai/*` packages)

Maintainers must publish **validated tarballs**, never raw workspace directories.

## Root cause (v1.1.0)

| Path | Result |
|------|--------|
| `pnpm pack` in each package | `package.json` inside `.tgz` resolves `catalog:` → semver and `workspace:*` → `@osva-ai/*@<version>` |
| `npm publish ./packages/<name>` | Publishes **source** `package.json` with unresolved `catalog:` / `workspace:*` |
| `node scripts/release/npm-pack-smoke.mjs` (before fix) | Packed with **pnpm** but did not assert tarball manifests; consumer used top-level `file:` installs |

Registry evidence: `npm view @osva-ai/contracts@1.1.0 dependencies` → `{ "zod": "catalog:" }`.

## Canonical workflow

1. Align versions: `pnpm release:version:check` (platform `VERSION` + `NPM_DISTRIBUTION_VERSION` when split)
2. Build + pack + fingerprint:

   ```bash
   node scripts/release/npm-pack-artifacts.mjs
   ```

   Output: `.release/npm-artifacts/<NPM_DISTRIBUTION_VERSION>/` (defaults to `VERSION` when override file absent)

   - Five `.tgz` files (dependency order)
   - `artifact-manifest.json` (filename + SHA-256 + resolved dependencies)

3. Local validation:

   ```bash
   node scripts/release/npm-pack-smoke.mjs
   ```

4. Optional post-publish consumer (requires registry access):

   ```bash
   node scripts/release/npm-registry-consumer-smoke.mjs
   ```

5. Print publish commands (does **not** publish):

   ```bash
   node scripts/release/npm-publish-plan.mjs --tag stable-candidate
   ```

6. Execute printed commands **in order**, one tarball per line:

   ```bash
   npm publish "<path/to/osva-ai-contracts-VERSION.tgz>" --access public --tag <dist-tag>
   # ... runtime-protocol, sdk, connector-sdk, cli
   ```

### Explicitly forbidden

- `npm publish ./packages/<name>` while `package.json` contains `catalog:` or `workspace:*`
- Publishing without a named dist-tag (no implicit `latest`)
- Publishing a tarball whose SHA-256 does not match `artifact-manifest.json`

## Dependency order

1. `@osva-ai/contracts`
2. `@osva-ai/runtime-protocol`
3. `@osva-ai/sdk`
4. `@osva-ai/connector-sdk`
5. `@osva-ai/cli`

## Recovery versioning (recommendation)

**Prefer option B:** publish corrected npm packages at **1.1.1** while keeping independently versioned **1.1.0** Python and GHCR artifacts that remain valid.

| | Option A (full 1.1.1 line) | Option B (npm-only 1.1.1) |
|---|---------------------------|---------------------------|
| Operational load | Rebuild/republish PyPI, GHCR, Helm, re-run full matrix | npm republication + manifest audit |
| Consumer messaging | Single aligned “1.1.1 everywhere” | “Use npm @1.1.1; image/Python 1.1.0 unchanged” |
| Acceptance | Re-record all registry digests | Extend npm audit; existing PyPI/GHCR evidence stands |
| Risk | Broader churn | Intentional npm/Python/GHCR version skew (document in release notes) |

Option B is the smallest safe recovery if Python wheel and GHCR image at 1.1.0 are already verified. Option A is cleaner long-term branding if maintainers accept a full patch release train.

Preserve **v1.1.0** git tag and historical registry metadata; do not unpublish or overwrite immutable npm versions.

**Active recovery (closeout recorded):** platform **`v1.1.0`**, corrective npm **1.1.1** published and registry-accepted — see [`NPM_1_1_1_RECOVERY.md`](NPM_1_1_1_RECOVERY.md). Public npm **`1.1.0`** tarballs remain defective and immutable; **`latest`** not promoted to **1.1.1**.

## Regression tests

```bash
node --test scripts/release/test/*.test.mjs
```

Fixtures under `scripts/release/test/fixtures/` mirror defective **1.1.0** registry manifests.
