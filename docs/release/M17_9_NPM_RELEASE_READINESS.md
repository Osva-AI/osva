# M17.9 Coordinated npm 1.1.4 release readiness

**Status:** **Published** — npm **`@osva-ai/*@1.1.4`** on dist-tags **`latest`** and **`stable-candidate`** (M17.9 closeout **2026-11-01**).

**Merge:** PR **#78** → **`f9fa20e`**

## Why all five npm packages are 1.1.4

| Surface | Version | Notes |
|---------|---------|--------|
| Platform (`VERSION`, GHCR, PyPI, Helm) | **1.1.1** | Unchanged — no platform release in this slice |
| npm `@osva-ai/*` (five packages) | **1.1.4** | `NPM_DISTRIBUTION_VERSION` |

Repository policy requires every public `@osva-ai/*` package to share **`NPM_DISTRIBUTION_VERSION`**. Independent **`@osva-ai/cli@1.1.4`** without aligned contracts, runtime-protocol, sdk, and connector-sdk would fail `pnpm release:version:check` and break the CLI packed dependency graph (`@osva-ai/contracts` / `@osva-ai/sdk` at matching semver).

Functional delta vs **1.1.3** is **CLI-only**: opt-in **`--remote-http-dev`** (merged PR #77). The other four packages are **version-alignment republishs** at **1.1.4** with unchanged platform API contracts.

## CLI capability: `--remote-http-dev`

- **`osva setup --remote-http-dev`** materializes `compose.remote-http-dev.yml`, generates capability secrets, and sets `OSVA_REMOTE_HTTP_DEV_PROFILE=true` so Compose merges the overlay.
- **Default `osva setup`** (no flag) uses **`compose.yml` only** — no runtime capability port publication or capability-secret wiring.
- The overlay keeps **loopback-only** capability port binding (`127.0.0.1`), requires **generated `OSVA_RUNTIME_CAPABILITY_SECRET`**, and honors explicit **`OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS`** for private-network allowances.
- Bundled platform image remains **`ghcr.io/osva-ai/osva:1.1.1`** (`distribution.json`).

See [`docs/engineering/REMOTE_HTTP_LOCAL_AGENT_SETUP.md`](../engineering/REMOTE_HTTP_LOCAL_AGENT_SETUP.md).

## Dependency and compatibility expectations

| Package | Depends on (packed tarball) |
|---------|----------------------------|
| `@osva-ai/contracts` | `zod@4.6.7` |
| `@osva-ai/runtime-protocol` | `@osva-ai/contracts@1.1.4`, `zod@4.6.7` |
| `@osva-ai/sdk` | `@osva-ai/contracts@1.1.4`, `@osva-ai/runtime-protocol@1.1.4`, `zod@4.6.7` |
| `@osva-ai/connector-sdk` | `@osva-ai/contracts@1.1.4`, MCP packages, `zod@4.6.7` |
| `@osva-ai/cli` | `@osva-ai/contracts@1.1.4`, `@osva-ai/sdk@1.1.4`, `ajv`, `zod@4.6.7` |

Consumers should pin **all five** `@osva-ai/*` packages to **1.1.4** together. Platform runtime remains **1.1.1** (GHCR / PyPI). **`@osva-ai/connector-npm@0.1.0`** (separate repository) is out of scope.

## Release verification evidence

| Check | Result |
|-------|--------|
| `pnpm release:version:check` | **PASS** (platform 1.1.1, npm 1.1.4) |
| PR **#78** CI **`verify`** | **SUCCESS** on merge commit **`f9fa20e`** |
| `node scripts/release/npm-registry-consumer-smoke.mjs` | **PASS** (post-publish) |
| npm dist-tags **`latest`** / **`stable-candidate`** → **1.1.4** (all five packages) | **PASS** (operator **2026-11-01**) |
| Clean global `@osva-ai/cli@1.1.4` + `osva setup --remote-http-dev` | **PASS** (install/smoke; see [`../operations/M17_ACCEPTANCE_SUMMARY.md`](../operations/M17_ACCEPTANCE_SUMMARY.md) §4) |
| M17.8 full model/tool/workflow replay on M17.9 install | **NOT RUN** (evidence remains M17.8) |

## Tarball SHA-256 manifest

Directory: `.release/npm-artifacts/1.1.4/` (generated; not committed).

| Package | File | SHA-256 |
|---------|------|---------|
| `@osva-ai/contracts` | `osva-ai-contracts-1.1.4.tgz` | `57345fb06c04c983bfc246c93dee9226cd302dba2c555300e13a430eb855a2b1` |
| `@osva-ai/runtime-protocol` | `osva-ai-runtime-protocol-1.1.4.tgz` | `79c3eb1c735cabdbed39a0bae0b6323b69cd2cb48fc0e528a82585869f164c24` |
| `@osva-ai/sdk` | `osva-ai-sdk-1.1.4.tgz` | `e145e419ac18395d07e3e47683535764ac246fc01a4b68a5abb01c8964ba9726` |
| `@osva-ai/connector-sdk` | `osva-ai-connector-sdk-1.1.4.tgz` | `42a8632af07a31762bae8a60e61a3ffd7955e9f539d8f6663d35036c59cc1478` |
| `@osva-ai/cli` | `osva-ai-cli-1.1.4.tgz` | `07ef8859df7dae90e3770200ff4af5ae6c10fb1462d73c2e32a3ba7a0a8e9eeb` |

Authoritative copy: `.release/npm-artifacts/1.1.4/artifact-manifest.json`.

## Operator commands (after merge + approval)

Pre-flight (registry must not already expose **1.1.4**):

```bash
for p in contracts runtime-protocol sdk cli connector-sdk; do
  npm view "@osva-ai/$p@1.1.4" version && echo "ABORT: $p@1.1.4 already exists" && exit 1
done
echo "OK: 1.1.4 absent on npm"
```

Build validated tarballs from the release commit:

```bash
pnpm release:version:check
node scripts/release/npm-pack-artifacts.mjs
node scripts/release/npm-pack-smoke.mjs
node scripts/release/npm-publish-plan.mjs --tag stable-candidate
# Execute printed npm publish <tarball> commands in order (maintainer auth + provenance as configured)
```

## Candidate publication sequence

1. `@osva-ai/contracts@1.1.4` → dist-tag **`stable-candidate`**
2. `@osva-ai/runtime-protocol@1.1.4` → **`stable-candidate`**
3. `@osva-ai/sdk@1.1.4` → **`stable-candidate`**
4. `@osva-ai/connector-sdk@1.1.4` → **`stable-candidate`**
5. `@osva-ai/cli@1.1.4` → **`stable-candidate`**

Use only tarball paths from `artifact-manifest.json`. Never `npm publish ./packages/<name>`.

## Registry validation (post-`stable-candidate`)

```bash
for p in contracts runtime-protocol sdk connector-sdk cli; do
  npm view "@osva-ai/$p@stable-candidate" version
  npm view "@osva-ai/$p@stable-candidate" dependencies
done
node scripts/release/npm-registry-consumer-smoke.mjs   # against stable-candidate
```

Confirm packed manifests have **no** `catalog:`, `workspace:*`, or `file:` dependency protocols.

Fresh install smoke:

```bash
npm install -g @osva-ai/cli@stable-candidate
osva version    # expect 1.1.4
osva help       # expect setup [--remote-http-dev]
npm pack @osva-ai/cli@stable-candidate
tar -tf osva-ai-cli-1.1.4.tgz | grep -E 'compose\.yml|compose\.remote-http-dev|distribution\.json'
```

## Promotion gates (`stable-candidate` → `latest`)

Promote **all five** packages together only after:

- Registry views show **1.1.4** on **`stable-candidate`** for every package.
- Dependency edges on the registry reference **`@osva-ai/*@1.1.4`** (not 1.1.3).
- `npm-registry-consumer-smoke` **PASS** against **`stable-candidate`**.
- Clean global install from npm and **`osva setup --remote-http-dev`** acceptance (operator-owned; see below).

Promotion (explicit):

```bash
for p in contracts runtime-protocol sdk connector-sdk cli; do
  npm dist-tag add "@osva-ai/$p@1.1.4" latest
done
```

Requires maintainer policy approval; do not promote if any package failed consumer smoke.

## Post-publication acceptance (recorded)

- **`node scripts/release/npm-registry-consumer-smoke.mjs`** — **PASS**
- Fresh **`npm install -g @osva-ai/cli@1.1.4`** and **`osva setup --remote-http-dev`** install smoke — **PASS** (M17.9; does not rerun M17.8 workflow)

Historical full-matrix registry acceptance (R1.1.3B) and M16 **`m16-111`** harness remain valid for their pinned npm versions; refresh to **1.1.4** is optional maintenance.
