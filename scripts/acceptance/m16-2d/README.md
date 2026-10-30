# M16.2D installation acceptance

Live Docker end-to-end acceptance for `osva setup` against a **locally built** OSVA image.

## Prerequisites

- `OSVA_ACCEPTANCE_LIVE=1`
- Docker Compose v2
- Node 24+

## Run

```bash
pnpm acceptance:m16-2d:test
pnpm exec turbo run build --filter=@osva-ai/cli...
docker build -t osva/local-m16-2d:dev -f Dockerfile .
OSVA_ACCEPTANCE_LIVE=1 pnpm acceptance:m16-2d
```

## Test-only overrides

| Variable | Purpose |
| --- | --- |
| `OSVA_M16_LOCAL_IMAGE` | Local OCI tag (default `osva/local-m16-2d:dev`) |
| `OSVA_SETUP_LOCAL_IMAGE` | Passed to `osva setup` (same tag) |
| `OSVA_SETUP_SKIP_IMAGE_PULL` | Skip registry pull during acceptance |
| `OSVA_ACCEPTANCE_INSTALL` | Enables acceptance-only secret capture files |
| `OSVA_SETUP_BOOTSTRAP_KEY_FILE` | Writes bootstrap API key once (0600, never logged) |
| `OSVA_SETUP_SETUP_TOKEN_FILE` | Writes setup token once (0600, never logged) |

Published GHCR images **before** Console/entrypoint updates will fail `console_distribution` until a matching release is published. Development acceptance uses the local image built from this branch.
