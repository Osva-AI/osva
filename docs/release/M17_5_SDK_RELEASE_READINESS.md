# M17.5 Public SDK distribution readiness

**Status:** Release candidate prepared (not registry-published).

## Problem

npm **`@osva-ai/sdk@1.1.2`** (`latest` / `stable-candidate`) was published **before** M17.2 capability resources landed. Registry tarballs omit `modelProfiles`, `connectors`, and `tools`.

## Version plan

| Surface | Version | Notes |
|---------|---------|--------|
| Platform (`VERSION`, GHCR, PyPI, Helm) | **1.1.1** | Unchanged — no platform API changes in this slice |
| npm `@osva-ai/*` | **1.1.3** | `NPM_DISTRIBUTION_VERSION` — npm-only patch |

## Coordinated npm publishing

All five public npm packages share **`NPM_DISTRIBUTION_VERSION`**. Publish **in dependency order** even when only `@osva-ai/sdk` changed functionally; `@osva-ai/contracts@1.1.2` already contains M17 HTTP schemas, so **contracts/runtime-protocol republish at 1.1.3 is version-alignment only**.

SDK-only install **`@osva-ai/sdk@1.1.3`** with **`@osva-ai/contracts@1.1.2`** would work at runtime, but the repo and CLI dependency graph require aligned **`1.1.3`** across the five packages.

## Operator commands (after merge + approval)

```bash
pnpm release:version:check
node scripts/release/npm-pack-artifacts.mjs
node scripts/release/npm-pack-smoke.mjs
node scripts/release/npm-publish-plan.mjs --tag stable-candidate
# Execute printed npm publish <tarball> commands in order (maintainer auth + provenance as configured)
```

Post-publication:

```bash
npm view @osva-ai/sdk@1.1.3 version
npm pack @osva-ai/sdk@1.1.3
tar -tf osva-ai-sdk-1.1.3.tgz | grep -E 'model-profiles|connectors|tools'
node scripts/release/npm-registry-consumer-smoke.mjs   # optional
```
