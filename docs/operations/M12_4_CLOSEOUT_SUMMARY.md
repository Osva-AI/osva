# M12.4 Closeout Summary (M12.4.1–M12.4.4)

**Platform baseline:** `VERSION` **1.1.0-rc.2**
**Slice M12.4.4:** Cross-process registered artifact storage + ecosystem acceptance.

## Delivered capabilities (M12.4.1–M12.4.4)

| Slice | Delivered |
| --- | --- |
| **M12.4.1** | External ecosystem compatibility audit, connector env contract, cross-repo documentation |
| **M12.4.2** | Connector ToolGateway CI reuse, compatibility matrix updates |
| **M12.4.3** | Public `ArtifactBlobStore` in `@osva-ai/contracts`, trusted `registered` driver, worker async resolve, external tarball typecheck |
| **M12.4.4** | Web + knowledge-worker `registered` resolve; worker→web registered cross-process integration; external packaged adapter runtime smoke |

## Public extension surfaces

| Surface | Package / contract | Version line |
| --- | --- | --- |
| Artifact blob port | `@osva-ai/contracts` (`artifact-blob-store.ts`, `artifact-storage-config.ts`) | Semver with contracts release |
| Registered module shape | `RegisteredArtifactBlobStoreModule` | Same |
| Connector Profile V1 | `docs/contracts/CONNECTOR_PROFILE_V1.md` + `@osva-ai/connector-sdk` | 1.1.0-rc.2 |
| REST artifacts | `docs/contracts/REST_API_V1.md` `/v1/artifacts*` | Unchanged |

## Cross-process artifact storage (M12.4.4)

| Process | Init | Shared backend requirement |
| --- | --- | --- |
| **Worker** | `onStart` → `resolveArtifactBlobStoreFromConfig` | Yes — writes blob bytes during runs |
| **Web** | `listen()` → resolve when `driver=registered` | Yes — HTTP list/get/content |
| **Knowledge worker** | `start()` → resolve when `driver=registered` | Yes — ingestion reads artifact streams |
| **Orchestrator / scheduler / MCP** | No direct `ArtifactBlobStore` | Metadata via Postgres only |

**Acceptance:** `apps/worker/test/integration/registered-artifact-storage.integration.test.ts` — worker remote run writes artifact through registered filesystem fixture; web `GET /v1/artifacts/:id/content` matches payload. Invalid module fails at web `listen()`.

**Built-in deployments:** Unchanged `filesystem` / `s3` synchronous wiring in all processes.

## Package-consumer evidence

| Step | Command | Result |
| --- | --- | --- |
| M12.4.3 tarball typecheck | `node scripts/acceptance/m12-4-3/run.mjs` | Included in M12.4.4 runner |
| M12.4.4 external runtime smoke | `node scripts/acceptance/m12-4-4/run.mjs` | Packaged fixture compiles against packed contracts; `createArtifactBlobStore` write/open/delete |

**Not verified in CI:** Custom GHCR/OCI image with adapter preinstalled (operator must install adapter into deployment `node_modules` and set env).

## Connector compatibility evidence

| Source | Declared target | Tested in this worktree |
| --- | --- | --- |
| osva-connectors `main` @ `f8298248…` | 1.1.0-rc.2 | Pin job only: `.github/workflows/github-connector-integration.yml` → osva-connectors `4ce706e…` (may trail `main`) |
| osva-examples `main` @ `72d6f573…` | OSVA **1.0.0** stable | Not re-run against this branch |
| osva-adapters | Empty repository | No tests; bootstrap deferred |

## Security model (artifact registration)

- Module specifier from operator env (`OSVA_ARTIFACT_BLOB_STORE_REGISTER_MODULE`) or trusted DI only.
- Invalid/missing exports fail startup (worker `onStart`, web `listen`, knowledge-worker `start`) — no partial registered backend.
- Workspace authorization remains in `ArtifactApplication`; adapters see opaque storage keys.
- No workflow/agent/REST/MCP path to select adapter modules.

## Known limitations

- Registered adapters run in-process with full process privileges (trusted operator model).
- No npm registry publication of new contract fields until normal `@osva-ai/contracts` release.
- osva-adapters repository empty — first package spec in [M12_4_3_ACCEPTANCE_SUMMARY.md](./M12_4_3_ACCEPTANCE_SUMMARY.md).
- GitHub connector integration pin may lag osva-connectors `main`.

## Deferred adapter categories

Model provider port, JobQueue external composition, vector/embedding ports, OpenTelemetry exporter port, dynamic plugin registry (unchanged from M12.4.3).

## M12.4 acceptance checklist

| Gate | Status |
| --- | --- |
| Public artifact port published in contracts | **PASS** (M12.4.3) |
| Worker registered resolve | **PASS** (M12.4.3) |
| Web + knowledge-worker registered resolve | **PASS** (M12.4.4) |
| Worker→web registered artifact E2E | **PASS** (M12.4.4 integration) |
| External tarball + runtime packaged adapter | **PASS** (M12.4.4 runner) |
| Filesystem/S3 default paths preserved | **PASS** (loader + existing integration) |
| Connector pin workflow present | **PASS** (config audit) |
| osva-adapters bootstrap | **DEFERRED** (empty repo) |
| Full `verify:ci:clean` on M12.4.4 branch | See verification table below |

## Verification (M12.4.4)

Record exit codes from the implementation run on branch `feat/m12-4-4-ecosystem-closeout`:

| Step | Command | Exit |
| --- | --- | --- |
| Format/lint/typecheck (affected) | `pnpm verify:quick` | **0** |
| Registered loader + web/kw unit | `pnpm exec turbo run typecheck lint test --filter=@osva/web --filter=@osva/knowledge-worker --filter=@osva/adapters-artifact-storage` | **0** |
| Cross-process registered integration | `pnpm --filter @osva/worker test:integration registered-artifact-storage` | **0** (2 tests) |
| M12.4.4 acceptance runner | `node scripts/acceptance/m12-4-4/run.mjs` | **0** |
| Docs links | `node scripts/release/docs-link-check.mjs` | **0** |
| Whitespace | `git diff --check` | **0** |
| Full `pnpm verify:ci` / `verify:ci:clean` | Not re-run in M12.4.4 closeout | — |

**Recommendation:** **READY TO COMMIT** for M12.4.4 slice scope; run `pnpm verify:ci:clean` before merge per [DEVELOPMENT_GATES.md](../engineering/DEVELOPMENT_GATES.md).