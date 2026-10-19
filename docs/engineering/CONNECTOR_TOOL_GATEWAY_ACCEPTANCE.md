# Connector ToolGateway acceptance (M12.4.2)

Independent MCP connector packages prove OSVA compatibility by exercising the **test-only**
ToolGateway harness in `@osva/tool-gateway` (private workspace package). Production connector
code stays in [osva-connectors](https://github.com/Osva-AI/osva-connectors); OSVA core does not
gain provider-specific branches.

## Fixture interface (connector repository)

Each connector that participates in cross-repo acceptance **must** publish:

1. **`build:test-stdio-fixture`** — compiles a stdio MCP entry script for integration tests.
2. **Committed or CI-built artifact** — a Node ESM script invokable with `node <entry>`.
3. **Documented relative path** from the osva-connectors repo root (for `OSVA_CONNECTORS_ROOT`).
4. **Loopback provider mock** — HTTP or in-process mock so CI does not need live provider credentials or production infrastructure.
5. **SecretReference wiring** — stdio `secretEnvironment` keys documented; values supplied via OSVA `SecretResolver` in tests only.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `OSVA_CONNECTOR_TEST_STDIO_ENTRY` | Generic absolute path to any connector stdio fixture |
| `OSVA_<CONNECTOR>_CONNECTOR_TEST_STDIO_ENTRY` | Connector-specific absolute path (example: `OSVA_GITHUB_CONNECTOR_TEST_STDIO_ENTRY`) |
| `OSVA_CONNECTORS_ROOT` | Checkout root of osva-connectors; combined with documented relative fixture path |
| `OSVA_REQUIRE_CONNECTOR_INTEGRATION` | When `true`, required connector cases fail if the fixture is missing |
| `OSVA_REQUIRE_<CONNECTOR>_CONNECTOR_INTEGRATION` | Connector-specific required gate (example: GitHub workflow) |

Resolution helpers: `packages/tool-gateway/test/fixtures/resolve-external-connector-stdio-entry.ts`.

## Generic harness API

Register a compatibility suite from a connector **case** object:

- Entry: `registerMcpConnectorCompatibilitySuite(case)` in
  `packages/tool-gateway/test/fixtures/mcp-connector-compatibility.harness.ts`.
- Reference case: `packages/tool-gateway/test/connector-compatibility/github.connector-compatibility.case.ts`.

### Case configuration fields

| Field | Meaning |
| --- | --- |
| `id`, `connectorLabel`, `connectorKey`, `connectorDisplayName` | Identity for logs and connector registration |
| `executionMode` | `required` (default CI) or `optional` (skip when fixture absent) |
| `stdioEntryResolution` | Env vars + optional `OSVA_CONNECTORS_ROOT` relative path |
| `requireIntegrationEnvVars` | Connector-specific `OSVA_REQUIRE_*` variables |
| `buildInstructions` | Shown when fixture missing |
| `toolImport` | Remote MCP tool name, import keys, logical binding name |
| `secrets` | `secretRefKey`, valid/invalid values, `secretEnvironment` map |
| `fixtureEnvironment(context)` | Non-secret stdio env (example: mock API base URL) |
| `startFixture()` | Starts loopback mock; returns request counters and mode controls |
| `happyPathInput` / `assertHappyPathOutput` | Successful ToolGateway invoke expectations |

Provider-specific mocks and assertions remain in the connector case file, not in OSVA production code.

### Scenarios executed (all connectors using the harness)

1. MCP discovery + ToolVersion import + immutable MCP binding metadata
2. ToolGateway happy-path invoke
3. `ToolPolicy` denial before MCP (`TOOL_NOT_AUTHORIZED`)
4. Unbound logical binding rejection (`TOOL_BINDING_NOT_FOUND` via test policy mirroring runtime)
5. Missing `SecretReference` on discover (`SecretNotFoundError`)
6. Stdio operator gate disabled (`StdioConnectorsDisabledError`)
7. Cross-workspace connector discovery denied
8. Foreign-workspace ToolGateway authorization denied (workspace-scoped test policy)
9. Sanitized provider auth failure (when case configures `assertInvalidCredentialsError`)
10. Sanitized provider 5xx (`MCP_TOOL_ERROR`, no debug leak marker)
11. Cancellation (`CONNECTOR_CANCELLED` via `AbortSignal` on MCP executor path)

Bounded deadlines: `DEFAULT_CONNECTOR_COMPATIBILITY_TIMEOUT_MS` (60s) per test; subprocesses and MCP pools close in `afterEach`.

## Local commands

```bash
# Build osva-connectors GitHub fixture (sibling checkout)
cd ../osva-connectors
pnpm --filter @osva-ai/connector-github build
pnpm --filter @osva-ai/connector-github build:test-stdio-fixture

# Run compatibility suite (osva repo)
cd ../osva-m12-4
export OSVA_CONNECTORS_ROOT="$PWD/../osva-connectors"
export OSVA_REQUIRE_GITHUB_CONNECTOR_INTEGRATION=true
pnpm exec turbo run build --filter=@osva/tool-gateway...
pnpm --filter @osva/tool-gateway test:integration:github-connector
```

Optional generic script name: `pnpm --filter @osva/tool-gateway test:integration:connector-compatibility`.

## CI example

Reusable workflow: `.github/workflows/connector-tool-gateway-integration-reusable.yml`.

GitHub connector job: `.github/workflows/github-connector-integration.yml` (pinned `osva_connectors_ref` commit SHA, no floating branches).

## Version pinning

- Pin **full commit SHA** of osva-connectors in workflow inputs.
- Bump the pin when the fixture contract or connector tool schema changes.
- Test against **built fixture artifacts** from that checkout (or published npm pack with the same layout).

## Failure diagnostics

| Symptom | Likely cause |
| --- | --- |
| `requires a built test stdio fixture` | Fixture not built or env path wrong |
| `SecretNotFoundError` | Test harness secrets map missing `secretRefKey` |
| `StdioConnectorsDisabledError` | Expected in stdio gate scenario; unexpected elsewhere |
| `CONNECTOR_CANCELLED` | Expected in cancellation scenario only |
| `MCP_TOOL_ERROR` with leak substrings | Provider mock or MCP client redaction regression |

## Security expectations

- No plaintext secrets in persisted `transportConfig`.
- Tool authorization and workspace-scoped test policies run **before** MCP in denial scenarios.
- Stdio connectors require operator enablement in production; harness verifies the gate.
- Outbound policy defaults remain strict (`allowPrivateNetworks: false` in harness).

## PostgreSQL connector status (M12.4.2)

`@osva-ai/connector-postgres` on osva-connectors `main` (2026-10-19) **does not** yet ship
`build:test-stdio-fixture` or `packages/postgres/test/fixtures/.build/stdio-postgres-fixture.js`.
OSVA documents the expected contract above; a second CI matrix entry is **deferred** until
osva-connectors publishes the fixture and a loopback PostgreSQL mock parallel to GitHub.

Required osva-connectors changes (no OSVA core provider code):

1. Add `build:test-stdio-fixture` and stdio entry under `packages/postgres/test/fixtures/.build/`.
2. Document env vars for mock database URL (`SecretReference` + loopback/test container in connector repo).
3. Expose a read-only MCP tool suitable for happy-path invoke (connection test tool).
4. Pin a commit SHA in a new reusable workflow `workflow_call` row when ready.

## Related documents

- [EXTERNAL_ECOSYSTEM_COMPATIBILITY.md](../architecture/EXTERNAL_ECOSYSTEM_COMPATIBILITY.md)
- [CONNECTOR_PROFILE_V1.md](../contracts/CONNECTOR_PROFILE_V1.md)
- [TOOL_CONTRACT.md](../contracts/TOOL_CONTRACT.md)
- [DEVELOPMENT_GATES.md](./DEVELOPMENT_GATES.md)
