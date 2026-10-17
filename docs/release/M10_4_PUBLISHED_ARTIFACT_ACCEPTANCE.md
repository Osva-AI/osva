# M10.4 published-artifact acceptance (RC2)

Secret-free summary of **M10.4** acceptance for OSVA Community **`1.1.0-rc.2`**. Temporary harness artifacts under `%TEMP%` are not part of this repository.

## Scope

| Slice | Description |
| --- | --- |
| **M10.4A** | Published-artifact audit and RC1 gap discovery |
| **M10.4B** | RC2 preparation |
| **M10.4C** | Local RC2 distribution acceptance (source-built image / local distribution) |
| **M10.4D** | Registry publication (npm, PyPI, GHCR, GitHub Release) |
| **M10.4E** | Published-registry acceptance (install and use from registries only) |
| **M10.4F** | Closeout and Python SDK documentation correction |

## Published identities

| Channel | Identity |
| --- | --- |
| **npm** (five packages) | `@osva-ai/contracts`, `@osva-ai/runtime-protocol`, `@osva-ai/sdk`, `@osva-ai/cli`, `@osva-ai/connector-sdk` at **`1.1.0-rc.2`**; dist-tag **`rc`** → RC2; dist-tag **`latest`** remains **`1.0.0`** |
| **PyPI** | **`osva-sdk==1.1.0rc2`** (PEP 440) |
| **GHCR** | **`ghcr.io/osva-ai/osva:1.1.0-rc.2`** |
| **OCI index digest** | `sha256:02e11050fe359c7c6e02003ae6d213163191da3e05da42e8fb5a450f2309ac8e` |
| **Linux AMD64 manifest** | `sha256:302a505636236b970c3746cb728b0059ae58286f8dcbea90ed4b3275a0c1d04f` |
| **Git tag** | **`v1.1.0-rc.2`** |
| **GitHub prerelease** | https://github.com/Osva-AI/osva/releases/tag/v1.1.0-rc.2 |
| **Release commit (tag target)** | `6bc970f03d364da35aaeb1fe8aaaa3218986b27f` |
| **GitHub `publishedAt`** | `2026-10-17T09:45:21Z` |

## M10.4E results (registry-only)

- Registry identity checks **passed** (npm, PyPI, GHCR digests, GitHub release assets and Helm tgz checksum).
- Isolated Compose project **`osva-m104e`** using **`ghcr.io/osva-ai/osva:1.1.0-rc.2`** (`docker compose up -d --no-build --wait`).
- Host ports **18080** (web) and **13100** (MCP).
- Migration head **`0023_execution_lease_slice`**; status **current**; schema integrity **`applied_and_matches`**.
- **`docker compose --profile bootstrap run --rm bootstrap`** executed **once** on the fresh stack.
- Registry-installed **`@osva-ai/cli@1.1.0-rc.2`**: **`osva doctor`**, init → build → manifest → validate → deploy ×2 (AgentVersion reuse) → **`osva run --wait`** ×2 (distinct Runs, **SUCCEEDED**, expected greeting) → **`osva status`** **passed**.
- **`@osva-ai/sdk@1.1.0-rc.2`** live smoke **passed**.
- **`osva-sdk==1.1.0rc2`** live smoke **passed** (`client.agents.list()`).
- Persistence **passed**: `docker compose down` (no `-v`), restart with `--no-build --wait`, agent readable, additional Run **SUCCEEDED**, final `docker compose down` (no `-v`); volumes retained.

## Non-secret IDs (M10.4E harness)

| Resource | ID |
| --- | --- |
| Workspace | `4bf943c0-b023-481f-88e3-6cd6805cb452` |
| Agent | `e6f64703-59d0-4ef0-86da-86f797e66a29` |
| AgentVersion | `12d3841b-d174-460a-9c29-557e494aa349` |
| Runs (golden path) | `6596db52-1801-4e16-9c4f-b966049992f5`, `63706ab4-e2a0-4b27-a3ee-b4514eca3d7c` |
| Persistence Run | `4e3aceac-0854-44bf-a652-7c97ffdb1c02` |

## Harness qualification

- Compose **bootstrap profile** ran **once** on the isolated stack.
- The first bootstrap API key was **not** retained in the temporary harness process.
- For recovery, the harness **deleted the original API-key row** and reissued an **ADMIN** key through **`bootstrap-cli`** (not a second compose bootstrap profile run).
- This was a **harness credential-lifecycle error**, not a product bootstrap failure.
- **M10.4C** had already validated clean bootstrap-token handling on the local-distribution path.
- No API keys or registry credentials belong in this document.

## Release gates (M10.4 closeout)

| Item | Record |
| --- | --- |
| GitHub CI + **`release-readiness`** on release commit `6bc970f03d364da35aaeb1fe8aaaa3218986b27f` | **Passed** on merged RC2 PR before publication |
| Registry publication (M10.4D) | **Done** |
| M10.4C / M10.4E acceptance | **Passed** |
| **`pnpm verify:ci:clean` during M10.4F** | **Not rerun locally** — not required to re-prove RC2 after CI/release-readiness on the release commit and M10.4E on published artifacts |
| **`pendingReleaseGates` (inventory)** | **None** for RC2 |

## Final disposition

- **RC2 published-artifact acceptance passed** (M10.4C local distribution + M10.4E registry-only).
- **No release gate remains pending** for M10.4 / published **`1.1.0-rc.2`**.
- **No release blocker** remains for RC2 registry use.
- npm/PyPI dist-tag **`latest`** remains **`1.0.0`**.
- GHCR **`:latest`** was **not** moved to RC2.
- **M10.4 is complete.** Optional future-version checklist: [`RC3_VERIFICATION.md`](RC3_VERIFICATION.md).
