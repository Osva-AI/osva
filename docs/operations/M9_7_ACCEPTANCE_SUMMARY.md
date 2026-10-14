# M9.7 production acceptance summary

Sanitized matrix for M9.7A / M9.7B.1–B.4C sign-off preparation. Raw evidence lives under `.acceptance-evidence/<runId>/` (gitignored). Do not commit dumps, tokens, or local logs.

**Evidence commit (M9.7 merge):** `65aae390bc057eec73a8883f9d6d407f0ac055f8` (PR #18)
**Evidence OSS version read at test time:** **`1.0.0`** (M9.7 slice did not bump VERSION)
**Current repository VERSION (RC.2 prep):** **`1.1.0-rc.1`** — M9.7 scenarios were **not** re-run on the version-bumped tree unless explicitly noted below.

## RC verification status

| Phase | Status |
|-------|--------|
| M9.7 local/operator evidence (B.1–B.4) | Recorded below (historical) |
| RC.2 version/documentation alignment | In progress / complete per RC.2 PR |
| Release-readiness CI on **`1.1.0-rc.1`** commit | **Pending** (required before RC.3) |
| RC.3 clean-room (`pnpm verify:ci:clean`, full acceptance) | **Pending** |
| Public tag / registry publish | **Not authorized** |

## How to run

```bash
pnpm acceptance:m9-7b                          # B.1 core only
pnpm acceptance:m9-7b -- --group=b2            # B.2 durability
pnpm acceptance:m9-7b -- --group=b3            # B.3 ops / security / observability
pnpm acceptance:m9-7b -- --group=b4            # B.4 deploy / DR / packaging checks
pnpm acceptance:m9-7b:test                     # Harness unit tests
```

Default `pnpm acceptance:m9-7b` runs **core (B.1) only**. It does **not** imply B.2–B.4 passed; use `--group` for full slices.

## Evidence classification legend

| Status | Meaning |
|--------|---------|
| **PASS** | Scenario completed; assertions satisfied |
| **FAIL** | Scenario ran; assertion or infrastructure failure |
| **BLOCKED** | Mandatory prerequisite missing (environment/tooling) |
| **NOT_RUN** | Deliberately optional or not executed (not a pass) |

## Consolidated scenario matrix

| Milestone | Scenario | Required | Latest status | Provenance | Reference run / notes |
|-----------|----------|----------|---------------|------------|------------------------|
| B.1 | `startup` | Yes | PASS | Local build + disposable Docker PG/Valkey | `f724fffe-c5f8-4cb2-82be-a16475acf13d` |
| B.1 | `schema` | Yes | PASS | Same | same |
| B.1 | `health` | Yes | PASS | Same | same |
| B.1 | `agent-run` | Yes | PASS | Same | Echo agent via Web → BullMQ → Worker |
| B.1 | `durable-outcome` | Yes | PASS | Same | PostgreSQL RunAttempt |
| B.1 | `fault-valkey-restart` | Yes | PASS | Same | Representative fault |
| B.1 | `shutdown` | Yes | PASS | Same | |
| B.1 | `isolation-audit` | Yes | PASS | Same | Acceptance container ownership |
| B.2 | `fault-valkey-stable-endpoint` | Yes | PASS | Local build + stable Valkey proxy | `58348447-77e3-480f-86e2-3fdb7ef983cd` |
| B.2 | `fault-worker-sigkill-lease` | Yes | PASS | Same | |
| B.2 | `fault-enqueue-claim-before-add` | Yes | PASS | Same | BullMQ enqueue test hooks |
| B.2 | `transport-concurrent-matrix` | Yes | PASS | Same | |
| B.2 | `transport-lost-reconciliation` | Yes | PASS | Same | |
| B.2 | `transport-competing-workers` | Yes | PASS | Same | |
| B.2 | `fault-postgres-interruption` | Yes | PASS | Same | |
| B.2 | `artifact-durability` | Yes | PASS | Same | Filesystem artifact backend |
| B.2 | `backup-restore-drill` | Yes | PASS | Same | Backup capture (not independent restore) |
| B.2 | `hooks-production-safety` | Yes | PASS | Same | Hooks not wired in production bootstrap |
| B.3 | `b3-auth-api-keys` … `b3-cleanup` (12) | Yes | PASS | Local stack + observability sidecars | `5dcced2b-d5ba-4847-a2cc-379d64f31788` |
| B.3 | Console browser UI | — | NOT_RUN (HTTP/BFF only) | B.3 functional/security HTTP | See `b3-console-functional-evidence.json` |
| B.4 | `b4-container-image-deploy` | Yes | PASS | **Source-built distribution image** | `90674551-a2e2-4633-8e95-e4684e7e392f` |
| B.4 | `b4-backup-restore-independent` | Yes | PASS | Local build; **filesystem** artifacts | same; checksum + post-restore run |
| B.4 | `b4-upgrade-compatibility` | Yes | PASS | `@osva/db` migration acceptance 0021→head | same |
| B.4 | `b4-postgres-stable-endpoint` | Yes | PASS | Stable PG proxy; hot reconnect observed | same |
| B.4 | `b4-valkey-stable-endpoint` | Yes | PASS | Stable Valkey proxy (B.2B pattern) | same |
| B.4 | `b4-helm-kind` | Yes | **BLOCKED** (local) | N/A on Windows dev host | `d31ece0f-f1a9-424c-895f-e4843384a902` — missing `kind`, `helm` |
| B.4 | `b4-deployment-security` | Yes | PASS | Static Compose/Helm review | `5f01797e-8c86-45e6-b04b-2b185011601d` |
| B.4 | `b4-console-grafana-browser` | No | **NOT_RUN** | B.3 HTTP evidence retained | `3589b680-5ec3-4dcb-9611-0c679b6a214b` |
| B.4 | `b4-distributed-trace-image` | Yes | PASS | Source-built image + OTLP capture | `55eb5c47-06bb-4f66-88fc-4dd2d2f67096` — **direct parent span chain** |
| B.4 | `b4-release-docs` | Yes | PASS | npm/Python pack smoke, docker-image-smoke, Helm static test | `666839b8-4c94-46be-a4ec-87f74a6c561b` |
| B.4 | `b4-cleanup` | Yes | PASS | | `5f01797e-…` |
| CI | Release Readiness `kind` job | Yes | **PENDING** | Builds `osva:$(cat VERSION)` after RC.2 | Must pass on **`1.1.0-rc.1`** commit after push |
| DR | S3-compatible independent restore | — | **NOT TESTED** | Product supports `s3` driver; drill used filesystem only | Follow-up before claiming S3 DR |

## Coverage gaps (explicit)

1. **Kind/Helm on local host:** BLOCKED — install `kind`, `kubectl`, `helm` or rely on GitHub **release-readiness → kind**.
2. **Kind script vs B.4 bar:** `scripts/deployment/kind-acceptance.mjs` validates cluster install, migrations hook, readiness, bootstrap API key, and authenticated `/v1/api-keys`. It does **not** yet run a deterministic Agent Run, worker pod restart, artifact fetch, or Helm upgrade smoke (see Kind coverage assessment in M9.7C PR report).
3. **S3/object-store restore:** NOT TESTED — do not treat filesystem restore as S3 proof.
4. **Console/Grafana graphical acceptance:** NOT RUN in B.4 (optional).
5. **Cross-store backup atomicity:** Not guaranteed between PostgreSQL and artifact store (documented in drill evidence).
6. **RC.2 version bump:** Acceptance evidence above reflects **`1.0.0`**-era runs; re-validate packaging/CI on **`1.1.0-rc.1`** in RC.3.

## Disaster recovery scope (tested)

- Independent PostgreSQL restore to new container + new Valkey + new artifact root: **PASS** (filesystem backend).
- Queue transport: reconstructed on fresh Valkey (BullMQ keys not restored).
- Schema integrity after restore: **PASS** (`migrations-integrity-cli`).

## Release Readiness (GitHub)

After RC.2 is pushed, require green on the **`1.1.0-rc.1`** commit:

- `verify-core` (includes `pnpm verify:ci`, migration verify, release static checks, release-readiness version test)
- `packages` (npm/Python pack smoke)
- `oci-compose-helm` (image build tagged from `VERSION`, compose acceptance, Helm template tests)
- **`kind`** (disposable cluster; `OSVA_KIND_ACCEPTANCE=true`)

Do **not** declare general production readiness until these pass on the candidate commit and RC.3 clean-room verification completes.

## Community production support boundaries (M9.7)

**Supported self-hosted modes:** Single-organization Compose or Helm on operator-managed PostgreSQL, Valkey, and artifact storage (filesystem on shared volume, or S3-compatible object store per configuration).

**Not supported / not promised:** Managed OSVA SaaS, Enterprise SSO/SCIM, zero-downtime HA, compliance certification, or multi-tenant hard isolation.

**Access model:** Bearer API keys; Console BFF trusts loopback/session configuration documented in Console engineering docs — not a public internet-facing admin UI without reverse-proxy and auth hardening.

**Durability:** PostgreSQL is lifecycle authority; BullMQ/Valkey is transport. Queue redelivery reuses the same RunAttemptId; a new logical retry creates a new RunAttemptId. Interrupted RUNNING attempts follow [EXECUTION_RECOVERY.md](./EXECUTION_RECOVERY.md).

**Outages:** `/health` is liveness; `/ready` reflects PostgreSQL/Valkey (and related dependencies). Rate limiting may fail closed when Valkey is unavailable (B.3 evidence).

**Telemetry:** OpenTelemetry export is opt-in via environment; collector outage behavior verified in B.3 (application continues; export may drop).

**Artifacts:** Metadata in PostgreSQL; bytes in configured BlobStore. S3-compatible storage is a supported **configuration**; independent S3 restore is **not** acceptance-tested in M9.7B.

**Side effects:** Tool and workflow side effects are not exactly-once; idempotency keys identify logical effects per product contracts.

**Operator responsibilities:** Secrets, TLS, network exposure, backup/restore procedures, bucket credentials, and resource limits per Compose/Helm runbooks.

## Related documentation

- [BACKUP_AND_RECOVERY.md](./BACKUP_AND_RECOVERY.md)
- [UPGRADE.md](./UPGRADE.md)
- [RUNBOOK.md](./RUNBOOK.md)
- [../deployment/CONFIGURATION.md](../deployment/CONFIGURATION.md) — artifact `filesystem` vs `s3`
- [../architecture/DEPLOYMENT_TOPOLOGIES.md](../architecture/DEPLOYMENT_TOPOLOGIES.md)
- [../release/RC3_VERIFICATION.md](../release/RC3_VERIFICATION.md)
