# OSVA Community 1.1.1 (M16 installer and lifecycle)

**Status:** Stage A source release preparation — **not registry-verified** until tag **`v1.1.1`**, GHCR **`ghcr.io/osva-ai/osva:1.1.1`**, and npm **`@osva-ai/*@1.1.2`** publish.

## Version matrix

See [`M16_5B_RELEASE_VERSION_MATRIX.md`](M16_5B_RELEASE_VERSION_MATRIX.md).

## Highlights

- **`osva setup`** — one-command local Docker Compose installation with secure secret generation.
- **Product Console** — bundled in the installation compose template; loopback publish; human-session onboarding.
- **Platform lifecycle** — `osva platform status|start|stop|restart|logs|doctor`.
- **Guarded upgrade** — `osva platform upgrade --to VERSION` with dry-run, backup attestation, migration/integrity hooks, and compose template refresh.
- **Upgrade path** — platform **1.1.0 → 1.1.1** (no new SQL; compose template adds Console and installation-status services).

## Consumer install (after publication)

```powershell
npm install -g @osva-ai/cli@1.1.2
osva setup --yes
```

Pinned image default: **`ghcr.io/osva-ai/osva:1.1.1`** (from CLI bundled `distribution.json`).

## Verification

Registry-only proof: [`acceptance:m16-registry`](../../scripts/acceptance/m16-registry/README.md) target **`m16-111`**.
