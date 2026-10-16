# M10.2E acceptance

Bounded checks for the published-style CLI + SDK developer workflow.

## Offline (safe, no credentials)

```bash
pnpm acceptance:m10-2e:pack
pnpm acceptance:m10-2e:test
```

`pack` builds workspace packages, installs `@osva-ai/cli` from local `.tgz` files into a temporary directory, runs `osva init`, and verifies bundled templates and `validate`.

## Live (opt-in, requires running OSVA)

Set **`OSVA_ACCEPTANCE_LIVE=1`** and the usual control-plane / trusted-runtime variables, then:

```bash
pnpm acceptance:m10-2e
```

Required:

- `OSVA_BASE_URL`
- `OSVA_API_KEY`
- Trusted runtime: **`OSVA_TRUSTED_RUNTIME_MODE=compose`** + **`OSVA_COMPOSE_DIR`**, or **`host`** + **`OSVA_TRUSTED_RUNTIME_ROOT`**

Optional: `OSVA_WORKSPACE_ID` (cross-checked against the API key), `OSVA_CLI_PATH` (defaults to `packages/cli/dist/bin/osva.js` after build).

The live runner performs: init → install → build → manifest → validate → deploy (twice, expects AgentVersion reuse) → run (twice with `--wait`, expects distinct Run IDs and scaffold `greeting` output).

It does **not** start Docker, mutate Compose volumes beyond installing the agent entrypoint, or run destructive infrastructure commands.
