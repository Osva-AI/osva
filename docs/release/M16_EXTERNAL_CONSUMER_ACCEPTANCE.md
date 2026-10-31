# M16 external-consumer acceptance summary

| Layer | Stage A (source / local-pack) | Stage B (published registries) |
|-------|------------------------------|--------------------------------|
| Version matrix | [`M16_5B_RELEASE_VERSION_MATRIX.md`](M16_5B_RELEASE_VERSION_MATRIX.md) | Same coordinates on npm/PyPI/GHCR |
| npm CLI M16 commands | `pnpm release:npm-pack-smoke` + local-pack harness | `pnpm acceptance:m16-registry` with **`OSVA_M16_ARTIFACT_SOURCE=published`** |
| OCI entrypoints | `node scripts/deployment/verify-installation-image.mjs` | GHCR digest audit in target **`m16-111`** |
| Install + onboarding + agent run | `acceptance:m16-registry` local-pack | Registry install group |
| Lifecycle | `acceptance:m16-4-lifecycle` or registry lifecycle group | Registry lifecycle group |
| **1.1.0 → 1.1.1 upgrade** | Registry **`upgrade`** group (local target image override) | Published **`1.1.0`** + **`1.1.1`** GHCR tags |

**Current status (Stage A handoff):** published **`m16-111`** acceptance is **NOT_RUN** until platform **1.1.1** and npm **1.1.2** exist on registries and digests are recorded in `scripts/acceptance/r11-registry-only/lib/targets.mjs`.

**Deterministic execution:** Hello Agent example uses the deterministic trusted runtime fixture (no paid model provider).
