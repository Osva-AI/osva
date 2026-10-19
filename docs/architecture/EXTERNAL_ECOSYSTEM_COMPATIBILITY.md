# External Ecosystem Compatibility (M12.4)

This document records the M12.4.1 audit of cross-repository integration boundaries among:

| Repository | Role |
| --- | --- |
| [Osva-AI/osva](https://github.com/Osva-AI/osva) | Core platform, public npm packages, generic acceptance |
| [Osva-AI/osva-examples](https://github.com/Osva-AI/osva-examples) | Independently maintained example applications |
| [Osva-AI/osva-connectors](https://github.com/Osva-AI/osva-connectors) | Independently maintained MCP connectors |
| [Osva-AI/osva-adapters](https://github.com/Osva-AI/osva-adapters) | Planned external infrastructure adapters (repository empty as of audit) |

**Audit baseline (osva worktree):** branch `feat/m12-4-ecosystem-compatibility`, `VERSION` **1.1.0-rc.2**.

**External sources inspected (GitHub `main`, read-only):**

| Repository | Commit (main at audit) | Notes |
| --- | --- | --- |
| osva-examples | `72d6f5737373f18793b40cf163d519a2d8ea4e8e` | `COMPATIBILITY.md` targets OSS **1.0.0** |
| osva-connectors | `2ac7c7877424a99cf6e05ddf821b434a0026a0c2` | GitHub + PostgreSQL packages; `docs/compatibility.md` targets **1.1.0-rc.2** |
| osva-adapters | *(empty)* | No default branch content |

**Pinned cross-repo CI reference:** `.github/workflows/github-connector-integration.yml` uses osva-connectors `4ce706e335422275a667faf15a26dba3485b2daf` (may trail `main`; update pin when connector fixture contract changes).

---

## Public vs internal integration surfaces (osva)

### Published npm packages (stable extension / consumer surface)

Defined in `scripts/release/read-version.mjs` → `PUBLIC_NPM_PACKAGES`:

| Package | Purpose |
| --- | --- |
| `@osva-ai/contracts` | IDs, gateway ports (`JobQueue`, `RuntimeAdapter`, `McpClientPool`, tool/connector registry types, `SecretReference`, outbound policy types), REST DTOs, Zod `./schemas` |
| `@osva-ai/runtime-protocol` | Runtime Protocol V1 schemas and capability paths |
| `@osva-ai/sdk` | Control-plane client (`OsvaClient`, `OsvaHttpClient`) and `@osva-ai/sdk/runtime` |
| `@osva-ai/connector-sdk` | Connector Profile V1 MCP authoring (`defineConnector`, `serveStdio`, Streamable HTTP) |
| `@osva-ai/cli` | Operator CLI (uses SDK only) |

Python: `sdks/python` (`osva-sdk` on PyPI in release flow) mirrors a subset of REST + runtime helpers; not version-locked to the same semver file as Node packages.

### Documented wire contracts (versioned in `docs/contracts/`)

| Contract | Consumer |
| --- | --- |
| [CONNECTOR_PROFILE_V1.md](../contracts/CONNECTOR_PROFILE_V1.md) | osva-connectors, connector-sdk |
| [RUNTIME_PROTOCOL_V1.md](../contracts/RUNTIME_PROTOCOL_V1.md) | Remote runtimes, examples, SDK `/runtime` |
| [REST_API_V1.md](../contracts/REST_API_V1.md) | SDK, examples, connectors (control-plane registration) |
| [TOOL_CONTRACT.md](../contracts/TOOL_CONTRACT.md) | ToolGateway behavior |
| [SECRET_RESOLVER_CONTRACT.md](../contracts/SECRET_RESOLVER_CONTRACT.md) | Connectors (stdio `secretEnvironment`), worker |
| [MODEL_GATEWAY_CONTRACT.md](../contracts/MODEL_GATEWAY_CONTRACT.md) | Model adapters (in-repo today) |

### Intentionally built-in (private workspace packages)

These implement ports but are **not** published for third-party npm consumption:

| Area | Packages | Composition |
| --- | --- | --- |
| Tool execution | `@osva/tool-gateway`, `@osva/adapters-mcp-client` | Worker / tests |
| Model execution | `@osva/model-gateway`, `@osva/adapters-model-*` | Worker |
| Memory / knowledge | `@osva/memory-gateway`, `@osva/adapters-vector-pgvector`, `@osva/adapters-embedding-openai-compatible` | Worker, knowledge-worker |
| Queue | `@osva/adapters-bullmq` | Web, worker, orchestrator |
| Runtimes | `@osva/adapters-runtime-typescript`, `-http`, `-container` | Worker |
| Artifacts | `@osva/adapters-artifact-*`, `@osva/adapters-artifact-storage` | Worker, web |
| Auth / identity | `@osva/adapters-auth` | Web, identity app |
| Observability | `@osva/adapters-opentelemetry` | Optional worker telemetry |
| Domain / DB | `@osva/domain`, `@osva/db`, apps | Never extension targets |

**Test-only helper (not a product extension API):** `@osva/adapters-mcp-client/testing` exports in-process fake MCP HTTP servers for osva integration tests.

### Security and policy surfaces relevant to externals

| Mechanism | Where enforced | External impact |
| --- | --- | --- |
| `SecretReference` | Domain + `SecretResolver` adapters | Connectors must use `secretEnvironment` / HTTP auth refs, never plaintext in `transportConfig` |
| Stdio connector gate | `stdioConnectorsEnabled` / operator env | Local MCP via subprocess is privileged |
| Outbound network policy | `@osva/outbound-network` in MCP client + runtime HTTP | Private-network MCP/runtime requires explicit operator opt-in |
| Tool policy | `ToolPolicy` before MCP invoke | Authorization is not granted by prompts |

---

## Repository ownership boundaries

### OSVA core owns

- Public contracts and published SDKs listed above
- ToolGateway, ModelGateway, MemoryGateway, EmbeddingGateway behavior and error normalization
- Generic Connector Profile V1 acceptance patterns and cross-repo CI hooks
- Security enforcement (secrets, outbound policy, stdio gate)
- REST `/v1` compatibility and release acceptance (`scripts/release/`, `pnpm release:acceptance`)

### osva-examples owns

- Example applications (01–18), workflows, agent templates, demo scripts
- Example-specific fixtures and consumer documentation (`COMPATIBILITY.md`)
- Verifying examples against **declared** OSVA release lines (today: 1.0.0 stable)

### osva-connectors owns

- Provider MCP implementations (`@osva-ai/connector-github`, `@osva-ai/connector-postgres`, …)
- Provider clients, auth configuration, tool schemas, output budgets
- Connector unit/integration tests, tarball/package acceptance, npm release
- Publishing test stdio fixtures for OSVA ToolGateway integration

### osva-adapters owns (future)

- Independently versioned packages implementing **documented adapter seams** (see below)
- Adapter-specific dependencies, tests, install docs
- No provider-specific business logic that belongs in connectors or core

**Rule:** Do not move provider-specific logic into osva core unless a second external consumer proves a generic platform requirement.

---

## Capability and dependency matrix

Classification key:

| Class | Meaning |
| --- | --- |
| **A** | Already supported |
| **B** | Documentation or example issue |
| **C** | Test-harness / CI gap |
| **D** | Genuine missing public contract |
| **E** | Genuine runtime capability gap |
| **F** | Deferred product enhancement |

| External requirement | Consuming repo | Existing public interface | OSVA version | Verification today | Gap | Owner | Required action | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MCP `tools/list` + `tools/call` | osva-connectors | Connector Profile V1 + `@osva-ai/connector-sdk` | 1.1.0-rc.2 | Connector repo CI; osva MCP client tests | **A** | — | — | — |
| Register ConnectorVersion + import ToolVersion | osva-connectors, examples | REST `/v1` + domain types in contracts | 1.0+ / 1.1-rc | `connector-import.test.ts`, worker MCP E2E | **A** | — | — | — |
| ToolGateway invoke MCP tool with secret stdio env | osva-connectors | ToolGateway + `McpClientPool` + SecretResolver | 1.1.0-rc.2 | GitHub connector integration workflow | **A** | — | — | — |
| Streamable HTTP MCP transport | osva-connectors (future) | `StreamableHttpTransportConfig`, connector-sdk HTTP helpers | 1.1.0-rc.2 | Fake HTTP MCP in `@osva/adapters-mcp-client/testing` | **A** | — | — | — |
| Structured JSON tool results | osva-connectors | MCP client normalization in `@osva/adapters-mcp-client` | 1.1.0-rc.2 | Connector package tests | **A** | — | — | — |
| Cancellation (`AbortSignal`) | osva-connectors | `McpToolExecutor` accepts `signal` | 1.1.0-rc.2 | Connector-side tests; osva **partial** | **C** | osva | Add generic cancellation scenario to connector acceptance (M12.4.2) | P2 |
| Cross-workspace connector isolation | osva-connectors | Domain connector apps + repository scoping | 1.1.0-rc.2 | GitHub integration test | **A** | — | — | — |
| ToolPolicy denial before MCP | osva-connectors | `ToolPolicy` + ToolGateway | 1.1.0-rc.2 | GitHub integration test | **A** | — | — | — |
| Sanitized MCP/provider errors | osva-connectors | ToolGateway + MCP client | 1.1.0-rc.2 | GitHub integration test | **A** | — | — | — |
| Stdio connector operator gate | osva-connectors | `StdioConnectorsDisabledError` | 1.1.0-rc.2 | GitHub integration test | **A** | — | — | — |
| Private network MCP endpoints | examples, local dev | `OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS` | 1.0+ | Documented in examples `COMPATIBILITY.md` | **B** | osva-examples | Keep documenting operator opt-ins | P3 |
| SDK resource for connectors/tools CRUD | osva-examples | REST via `OsvaHttpClient` | 1.0.0 SDK | Examples 02+ | **B** | osva / examples | Document pattern; optional SDK helpers in 1.2+ (**F**) | P3 |
| Examples target 1.0.0 vs core 1.1.0-rc.2 | osva-examples | `COMPATIBILITY.md` | 1.0.0 vs 1.1.0-rc.2 | Examples CI | **B** | osva-examples | Refresh compatibility row when adopting 1.1 stable | P2 |
| Connectors target 1.1.0-rc.2 | osva-connectors | `docs/compatibility.md` | 1.1.0-rc.2 | Connector CI | **A** | — | — | — |
| `@osva-ai/connector-github` npm publish | osva-connectors | npm registry | 0.3.0 planned | Tarball acceptance in connector repo | **B** | osva-connectors | Publish per RELEASE-CHECKLIST | P1 |
| Generic connector ToolGateway CI (non-GitHub) | osva-connectors (postgres) | Same as GitHub pattern | 1.1.0-rc.2 | None in osva for postgres | **C** | osva | Reuse acceptance env contract; optional second pin job (M12.4.2) | P2 |
| Connector repo runs osva compatibility without monorepo fork | osva-connectors | Env-based stdio fixture resolution (M12.4.1) | 1.1.0-rc.2 | Documented below | **A** (foundation) | osva | Document env vars; consumer runs against published `@osva/tool-gateway` **not public** — see next row | P2 |
| Published package to execute ToolGateway harness externally | osva-connectors | *(none)* | — | Harness lives in private `@osva/tool-gateway` tests | **D** | osva | M12.4.2: extract **contract doc + optional devDependency test kit** or document running osva CI job template only | P2 |
| Remote HTTP runtime + tool capability | osva-examples | Runtime Protocol V1 + SDK runtime | 1.0.0 | Example 02, in-repo E2E | **A** | — | — | — |
| Workflow V3 + approvals + event wait | osva-examples | REST + contracts | 1.0+ | Example 03 | **A** | — | — | — |
| Python remote runtime example | osva-examples | Python SDK runtime module | 1.0+ | Example 13, `verify:python` | **A** | — | — | — |
| Replace BullMQ / JobQueue | osva-adapters | `JobQueue` in `@osva-ai/contracts` | — | In-repo contract tests | **D/E** | osva-adapters | Requires composition-root wiring; no dynamic load (**F** for plugins) | P3 |
| Replace model provider adapter | osva-adapters | `ModelProviderAdapter` in **private** `@osva/model-gateway` | — | In-repo adapters | **D** | osva | Publish adapter interface or stability doc before external packages (M12.4.3) | P2 |
| Replace artifact blob store | osva-adapters | `ArtifactBlobStore` in **private** `@osva/domain` | — | Filesystem/S3 in-repo | **D** | osva | Expose stable port package or documented copy of port (M12.4.3) | P2 |
| Swap artifact driver without core source edit | osva-adapters | `createArtifactBlobStore` env drivers | 1.1.0-rc.2 | Worker env config | **E** | osva | Static composition only: new driver in core or rebuild worker with new dep | P2 |
| OpenTelemetry backend | osva-adapters | `@osva/adapters-opentelemetry` (private) | — | Optional worker env | **F** | osva-adapters | First external adapter candidate after port publish | P3 |
| Dynamic adapter loading / plugins | osva-adapters | Not supported | — | — | **F** | — | Explicitly out of scope M12.4 | — |
| osva-adapters repository bootstrap | osva-adapters | — | — | Empty repo | **B** | osva-adapters | Add README + first package after M12.4.3 port decision | P3 |

### Ranked confirmed core integration gaps (M12.4.1)

1. **D / P2 — External adapter ports not on npm:** Third parties cannot implement artifact/model/embedding adapters against a published stable TypeScript port (interfaces live in private `@osva/domain` / `@osva/model-gateway`).
2. **C / P2 — Second connector CI case:** Generic harness + reusable workflow exist; PostgreSQL fixture not yet published in osva-connectors.
3. **D / P2 — No published connector ToolGateway harness package:** External repos can build fixtures and run osva’s CI template, but there is no npm-delivered test kit (by design for M12.4.2).

### False-positive gaps (already supported)

- MCP discovery/import/version immutability — covered by domain + `connector-import.test.ts`.
- Secret handling for stdio — covered by GitHub integration + `SecretNotFoundError` path.
- Output normalization — MCP client + ToolGateway error codes (`MCP_TOOL_ERROR`, etc.).
- Connector SDK authoring surface — `@osva-ai/connector-sdk` exports match Profile V1.

---

## Generic connector acceptance architecture (M12.4.2)

### Reference implementation

| Layer | GitHub reference case | Generic harness |
| --- | --- | --- |
| CI workflow | `.github/workflows/github-connector-integration.yml` calls reusable `connector-tool-gateway-integration-reusable.yml` | Same reusable workflow for future connectors (pinned SHA, matrix inputs) |
| Integration test | `packages/tool-gateway/test/connector-compatibility/github.connector-compatibility.case.ts` | `registerMcpConnectorCompatibilitySuite()` in `mcp-connector-compatibility.harness.ts` |
| Vitest entry | `test/github-connector-tool-gateway.integration.test.ts` (CI alias) | `test/mcp-connector-tool-gateway.integration.test.ts` |
| Fixture resolution | `resolve-github-connector-test-entry.ts` | Shared `resolve-external-connector-stdio-entry.ts` |
| Maintainer docs | — | [CONNECTOR_TOOL_GATEWAY_ACCEPTANCE.md](../engineering/CONNECTOR_TOOL_GATEWAY_ACCEPTANCE.md) |

### Reusable stdio fixture environment contract

Connector repositories SHOULD ship:

1. A **built stdio entry script** (committed under `test/fixtures/.build/` or produced by `build:test-stdio-fixture`).
2. Documented **relative path from repo root** to that script.

OSVA integration runners SHOULD set one of:

| Variable | Meaning |
| --- | --- |
| `OSVA_CONNECTOR_TEST_STDIO_ENTRY` | Absolute path to stdio entry (any connector) |
| `OSVA_<NAME>_CONNECTOR_TEST_STDIO_ENTRY` | Connector-specific explicit path (GitHub: `OSVA_GITHUB_CONNECTOR_TEST_STDIO_ENTRY`) |
| `OSVA_CONNECTORS_ROOT` | Connector monorepo root + documented relative fixture path |

Fail CI when required:

| Variable | Meaning |
| --- | --- |
| `OSVA_REQUIRE_CONNECTOR_INTEGRATION` | Generic gate (also honored by GitHub suite) |
| `OSVA_REQUIRE_GITHUB_CONNECTOR_INTEGRATION` | GitHub workflow |

Implementation helpers (osva private tests): `packages/tool-gateway/test/fixtures/resolve-external-connector-stdio-entry.ts`.

### Scenario checklist (M12.4.2 generic harness)

| # | Scenario | Generic harness |
| --- | --- | --- |
| 1 | MCP init + discover + import ToolVersion | Yes |
| 2 | ToolGateway happy-path invoke | Yes |
| 3 | ToolPolicy deny before MCP | Yes |
| 4 | Missing SecretReference on discover | Yes |
| 5 | Stdio gate disabled | Yes |
| 6 | Provider auth failure sanitized | Yes (per connector case) |
| 7 | Provider 5xx sanitized | Yes |
| 8 | Cross-workspace discovery denied | Yes |
| 9 | Cancellation aborts in-flight call | Yes (`AbortSignal` on MCP executor) |
| 10 | Unbound logical binding rejected before MCP | Yes (`RuntimeBindingToolPolicy` mirrors runtime) |
| 11 | Workspace isolation on invoke | Yes (workspace-scoped test policy on invoke) |

**Follow-on (optional):** Publish `@osva-ai/connector-acceptance` dev kit only if multiple external repos need the harness without osva checkout — not required for M12.4.2.

**PostgreSQL connector:** deferred until osva-connectors publishes stdio fixture contract (see CONNECTOR_TOOL_GATEWAY_ACCEPTANCE.md).

---

## External adapter packaging recommendation

### Answers (M12.4.1)

1. **Public adapter interfaces today:** Only generic ports in `@osva-ai/contracts` (e.g. `JobQueue`, `RuntimeAdapter`, `SecretResolver`, MCP client pool interfaces). Domain ports (`ArtifactBlobStore`, repositories) and `ModelProviderAdapter` are **not** public npm APIs.
2. **Built-in adapters:** BullMQ, in-repo model providers, filesystem/S3 artifacts, pgvector, OpenAI-compatible embeddings, TypeScript/HTTP/container runtimes, MCP client, auth — wired in `apps/worker/src/process.ts`.
3. **Independent compile today:** A third-party package can depend on `@osva-ai/contracts` only for queue/runtime/MCP-related experiments; not for drop-in worker artifact/model replacement.
4. **Integrate without core source change:** **No** for new adapter categories — worker statically imports adapter packages. Operators can configure existing drivers (artifact env) without code changes.
5. **First external adapter categories:** (1) **Artifact blob store** behind a published port; (2) **Model provider** behind published `ModelProviderAdapter`; (3) **OpenTelemetry** exporter wiring — lowest product risk after ports exist.
6. **Guarantees needed:** Same as in-repo adapters — no bypass of gateways, secrets by reference, no arbitrary code load, semver on published port packages.
7. **Registration mechanism:** Required for productized swapping; **static trusted composition** (worker bundle lists adapter packages at build time) is sufficient before any dynamic registry.
8. **Dynamic loading:** Out of scope — do not load untrusted adapter code at runtime.

### Minimal first osva-adapters package (after M12.4.3)

Recommend **`@osva-ai/adapter-artifact-*`** implementing a **published** `ArtifactBlobStore` port (or official `@osva-ai/adapter-ports` package extracted from domain), selected via existing `loadArtifactStorageConfig()` driver enum or a new documented driver string — still static composition in worker.

---

## Version compatibility policy

### Principles

1. **Independent versioning:** OSVA git release (`VERSION`), each npm package, connector packages (`@osva-ai/connector-*`), and osva-examples track **their own** semver. They must not be forced to numerically match.
2. **Minimum compatible OSVA release:** Each external repo declares a row in its `COMPATIBILITY.md` (examples: 1.0.0; connectors: 1.1.0-rc.2). Connectors SHOULD declare compatible `@osva-ai/connector-sdk` semver range.
3. **Dependency style:**
   - **Published consumers** (examples, connectors): pin or range on **npm** `@osva-ai/*` artifacts (`^1.0.0` after stable; for rc, pin exact rc until 1.1.0 stable).
   - **Monorepo osva:** `workspace:*` only.
4. **Pre-release:** `-rc` packages may break; external repos pin exact rc versions (connectors already document 1.1.0-rc.2).
5. **Breaking contract changes:** Require ADR + semver major on affected `@osva-ai/contracts` / REST major; migration window per [COMPATIBILITY_AND_MIGRATION.md](./COMPATIBILITY_AND_MIGRATION.md).
6. **Smoke testing:** `pnpm release:acceptance` + `npm-pack-smoke.mjs` for public packages; connector repo `pnpm test:package-acceptance`; osva GitHub connector workflow for ToolGateway cross-repo.
7. **Consumer acceptance:** External repos SHOULD test against **published tarballs** from npm (or `pnpm pack` outputs), not osva monorepo `workspace:*`, before release.

### Compatibility matrix (summary)

| Artifact | Versioning | Declares compatibility |
| --- | --- | --- |
| OSVA platform release | `VERSION` file | Release notes, ADRs |
| `@osva-ai/contracts` | package.json semver | Connector-sdk transitive dep |
| `@osva-ai/sdk` | package.json semver | osva-examples COMPATIBILITY.md |
| `@osva-ai/connector-sdk` | package.json semver | osva-connectors docs |
| Connector packages | independent semver | osva-connectors `docs/compatibility.md` |
| Adapter packages (future) | independent semver | osva-adapters + min OSVA release |
| osva-examples | repo lockfile | COMPATIBILITY.md (OSVA 1.0.0 today) |

---

## Recommended scope for M12.4.2 – M12.4.4

| Slice | Scope |
| --- | --- |
| **M12.4.2** | **Done in tree:** parameterized harness, reusable CI workflow, maintainer doc; PostgreSQL second case deferred pending osva-connectors fixture |
| **M12.4.3** | Publish or extract **adapter port** package(s); bootstrap osva-adapters with one reference adapter; static worker composition doc |
| **M12.4.4** | osva-examples 1.1 alignment; optional SDK connector helpers; npm-published connector-github; reduce core changes when adding connectors |

---

## External repository changes required (not in M12.4.1)

| Repo | Change |
| --- | --- |
| osva-connectors | Keep stdio fixture contract stable; document `OSVA_CONNECTOR_TEST_STDIO_ENTRY`; publish GitHub connector to npm |
| osva-examples | Update COMPATIBILITY when moving to 1.1 stable; continue HTTP client patterns for connector CRUD |
| osva-adapters | Initialize README and first package after core port decision |

---

## Risks and security

- **Stdio connectors** are subprocess execution — must remain operator-gated.
- **Cross-repo CI pins** must not float on branch refs (supply chain + reproducibility).
- **Publishing adapter ports** without strict semver allows silent worker ABI skew — gate with contract tests.
- **Examples on 1.0.0** while connectors use 1.1.0-rc.2 creates a perceived split; document until examples bump.

---

## Related documents

- [CONNECTOR_PROFILE_V1.md](../contracts/CONNECTOR_PROFILE_V1.md)
- [COMPATIBILITY_AND_MIGRATION.md](./COMPATIBILITY_AND_MIGRATION.md)
- [REPOSITORY_MAP.md](./REPOSITORY_MAP.md)
- [DEVELOPMENT_GATES.md](../engineering/DEVELOPMENT_GATES.md) (verification playbook; `ENGINEERING_VERIFICATION_PLAYBOOK.md` not present in repo)
