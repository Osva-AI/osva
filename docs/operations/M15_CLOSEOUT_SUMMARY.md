# M15 Closeout Summary — Production Adoption & Operational Experience

Branch: **`feat/m15-5-production-adoption-closeout`** (from **`045122e`** M15.4 merge)

Acceptance record: [`M15_ACCEPTANCE_SUMMARY.md`](M15_ACCEPTANCE_SUMMARY.md)

## 1. Delivered capabilities

| Area | Delivered |
| --- | --- |
| **Documentation baseline (M15.1)** | IMPLEMENTATION_TRACKER/STAGE_ROADMAP aligned; UPGRADE through migration **0030**; RC.4 verification reconciled; Console docs for Knowledge, Memory, Testing Studio, Models |
| **Evaluation Studio UX (M15.2)** | Browser acceptance for quality-gate **PASS**, **FAIL**, **INDETERMINATE**; lifecycle vs gate verdict copy |
| **Operator experience (M15.3)** | `OperatorGuidancePanel` + shared diagnostics on Run, WorkflowRun, connectors, models, knowledge failures |
| **Unified acceptance (M15.4)** | `pnpm acceptance:m15` profiles orchestrating M12.3, M13 browser suites, M14 security, RC.4 smoke |
| **Closeout (M15.5)** | Acceptance/closeout summaries, release inventory reconciliation, ecosystem matrix, roadmap completion |

## 2. Architecture impact

**None** — M15 is documentation, Console UX, and test orchestration only. Control plane contracts, migrations (head remains **0030**), ToolGateway/MCP enforcement, and security defaults are unchanged from M14.

## 3. User experience improvements

- Operators see consistent severity, next steps, and recoverability on common Console failure modes (runs, workflows, connectors, models, knowledge).
- Evaluation Studio browser tests close the M13.7.5 documented Playwright gap for gate presentation.
- Single command (`pnpm acceptance:m15`) documents which existing suites prove each adoption journey.

## 4. Verification performed

- **M15.4:** Operator **`full`** profile — **23/23 PASS** (`artifacts/acceptance/m15-4/latest.json`, **2026-10-28**).
- **M15.5:** `release:version:check`, `db:migrations:verify`, `acceptance:m15:test`, `git diff --check`, `verify:changed` on closeout docs.
- **Hosted CI:** GitHub **CI** **`verify:ci`** **success** on **`045122e`** (M15.4 merge).
- **Not re-run:** `pnpm verify:ci:clean`; isolated default/integration/browser profile invocations (superset covered by **`full`**).

## 5. Deferred scope

- PyPI **`osva-sdk==1.1.0rc4`** publication
- GHCR **`1.1.0-rc.4`** OCI republish
- M10.4E published-registry-only Compose + CLI/SDK consumer replay for RC.4
- M15.4 optional long-lived DB **`applied_and_matches`**
- M9.7B deployment-grade B3/B4 scenarios (use `pnpm acceptance:m9-7b` when needed)
- osva-examples explicit RC.4 consumer verification
- OIDC and Enterprise identity (unchanged roadmap deferrals)

## 6. Operational limitations

- Install from **npm `@rc`** supports TypeScript SDK/CLI/connector-sdk; **Python** adopters remain on **`1.1.0rc2`** until PyPI publish.
- Container/Helm adopters pinning **`1.1.0-rc.4`** must **build from source/tag** or wait for GHCR — latest published GHCR tag is **`1.1.0-rc.2`**.
- Console cannot surface worker queue depth or external connector latency without successful API operations.
- Workflow **approval** does not replace per-tool-call authorization (M14.5 binding is workflow-node scoped).

## 7. Release compatibility status

See [`M15_ACCEPTANCE_SUMMARY.md`](M15_ACCEPTANCE_SUMMARY.md) §7 and [`../release/RC4_VERIFICATION.md`](../release/RC4_VERIFICATION.md).

**Summary:** RC.4 **npm + Git tag + GitHub prerelease** are verified; **PyPI/GHCR/M10.4E** remain open. [`COMPATIBILITY.md`](../release/COMPATIBILITY.md) and [`RELEASE_CANDIDATE_INVENTORY.json`](../release/RELEASE_CANDIDATE_INVENTORY.json) updated in M15.5 to match.

## 8. Recommendations for next milestone

1. **Complete RC.4 distribution:** PyPI, GHCR, regenerate inventory digests, run M10.4E-equivalent acceptance.
2. **External repos:** Bump osva-examples (and connector pins) to **`1.1.0-rc.4`**; run packaged consumer CI.
3. **Operator evidence:** Record `pnpm db:migrations:integrity` + `applied_and_matches` on a reference Compose stack.
4. **Optional:** Re-run `pnpm acceptance:m15:full` on merge commit with git SHA recorded in evidence JSON (runner enhancement).
5. **Product/security backlog:** Tool-call-level approval policy (if desired), OIDC Community slice, deeper multi-tenant isolation — per STAGE_ROADMAP post-M15 items.
