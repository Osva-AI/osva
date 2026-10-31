# M16.5B coordinated release version matrix

**Status:** Stage A preparation (not registry-verified until publication).

## Registry availability check (pre-bump)

| Coordinate | Published today? | Action |
|------------|------------------|--------|
| Platform **`1.1.1`** (VERSION, GHCR, PyPI, Helm) | **No** | New patch platform release |
| npm **`@osva-ai/*@1.1.2`** | **No** (404 on registry) | New npm distribution |
| npm **`@osva-ai/*@1.1.1`** | **Yes** (immutable) | Pre-M16 CLI; do not republish |
| GHCR **`ghcr.io/osva-ai/osva:1.1.0`** | **Yes** (immutable) | Upgrade source image only |
| GHCR **`ghcr.io/osva-ai/osva:1.1.1`** | **No** | Publish after build |

## Chosen matrix (Stage A)

| Surface | Version | Authority |
|---------|---------|-----------|
| OSVA platform / runtime | **1.1.1** | Root `VERSION`, git tag **`v1.1.1`** (future) |
| GHCR image tag | **1.1.1** | `ghcr.io/osva-ai/osva:1.1.1` |
| Public npm `@osva-ai/*` | **1.1.2** | `NPM_DISTRIBUTION_VERSION` |
| Python `osva-sdk` | **1.1.1** | `sdks/python/pyproject.toml` |
| Helm chart / appVersion | **1.1.1** | `deploy/helm/osva/Chart.yaml` |
| CLI bundled `distribution.json` | platform **1.1.1** | Points at GHCR **1.1.1** |

## Split-version policy

Per `scripts/release/read-version.mjs` and `NPM_1_1_1_RECOVERY.md`:

- Platform surfaces share one **`VERSION`**.
- npm packages share **`NPM_DISTRIBUTION_VERSION`**, which may differ in **patch** from platform when npm-only corrective releases are required.
- **Major.minor** must align (here **1.1.x** for both **1.1.1** platform and **1.1.2** npm).

M16 is a **platform + npm** release: new OCI entrypoints and new CLI installer bundle. npm **1.1.2** avoids reusing **1.1.1** tarballs that lack M16 commands.

## Supported upgrade path (M16)

| From | To | SQL | Compose template |
|------|-----|-----|------------------|
| **1.1.0** (published GHCR) | **1.1.1** | No new migrations (schema head unchanged at **`0030`**) | **Yes** (adds Console + installation-status services) |

Legacy **1.1.0** installs created with **`deploy/compose`** (no `osva setup`) remain valid upgrade sources; registry upgrade acceptance bootstraps that layout before invoking **`osva platform upgrade`**.

## Evidence placeholders (Stage B)

After maintainer publication, record in `scripts/acceptance/r11-registry-only/lib/targets.mjs` target **`m16-111`**:

- `ghcrIndexDigest` / `ghcrLinuxAmd64ManifestDigest`
- PyPI wheel/sdist SHA-256 (if **1.1.1** published)
- `releaseCommit` for tag **`v1.1.1`**
- Set `registryArtifactsReady: true`
