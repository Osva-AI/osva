# Branch verification (`pnpm verify:branch`)

Canonical **branch-readiness** command for local development and optional pre-push hooks. Policy context lives in [DEVELOPMENT_GATES.md](./DEVELOPMENT_GATES.md) and [OSVA_VERIFICATION_STRATEGY.md](./OSVA_VERIFICATION_STRATEGY.md) (the repository does not ship a separate `ENGINEERING_VERIFICATION_PLAYBOOK.md` file).

## Usage

```powershell
pnpm verify:branch
pnpm verify:branch -- --base=origin/main
pnpm verify:branch -- --profile=integration
```

| Profile | Behavior |
| --- | --- |
| `fast` (default) | Changed-file Prettier write/check, affected lint → typecheck → build → unit tests, targeted regression tests from the impact map, patch integrity. Integration/browser obligations are reported as **NOT RUN**. |
| `integration` | Same as fast, then runs impacted integration/browser obligations sequentially when Docker or other prerequisites are available. |

Compare base defaults to `origin/main` using `git merge-base` so unrelated commits on `main` are excluded. The inventory includes committed branch changes, staged/unstaged edits, and untracked (non-ignored) files.

Machine-readable output: `artifacts/verification/branch-verification.json` (gitignored).

## Readiness classifications

| Class | Meaning |
| --- | --- |
| `LOCAL_PASS` | All executed checks passed and no mandatory obligations remain outstanding. |
| `BLOCKED` | Local static/unit checks passed, but required integration or browser suites were **NOT RUN** (exit code 2). Not an unconditional “ready to merge”. |
| `FAILED` | A executed check failed, or unknown source paths were detected. |

**NOT RUN is never treated as PASS.**

## How packages are selected

1. Changed paths are mapped to owning workspace packages (same roots as `verify:quick` / `verify:changed`).
2. Declarative **impact rules** add turbo tasks, targeted Vitest files, and integration obligations (Console routes, Agent Studio, contracts, runtime adapters, migrations, and so on).
3. **Direct consumers** are included when shared contracts or schemas change (`workspace-graph.mjs`).
4. Root config changes (`package.json`, `turbo.json`, ESLint, TypeScript bases, …) widen to full cached turbo lint/typecheck/test/build — same as existing changed verification.

## Integration obligations

Heavy suites (worker integration, DB integration, browser acceptance, and similar) are **obligations**: the default profile lists them with the exact command to run. Use `--profile=integration` when Docker/Playwright are available locally.

CI remains authoritative for the full clean matrix (`pnpm verify:ci:clean`).

## Optional pre-push hook

Not installed automatically.

```powershell
node scripts/verification/install-pre-push-hook.mjs enable
node scripts/verification/install-pre-push-hook.mjs disable
node scripts/verification/install-pre-push-hook.mjs status
```

Honors non-zero exit status from `pnpm verify:branch`. Does not overwrite a foreign `.git/hooks/pre-push` unless it already contains the OSVA marker.

## Failure triage

1. Read the terminal **FAILED STAGE** / **FAILED COMMAND** banner (same harness as `verify.mjs`).
2. Open `artifacts/verification/branch-verification.json` for the full check list and durations.
3. For `BLOCKED`, run the listed obligation commands or re-run with `--profile=integration`.
4. For **unknown source paths**, extend `scripts/verification/branch-impact.mjs` with an explicit area rule — do not silence with a broad ignore.

## Known limitations

- Does not replace `verify:ci:clean` or Python SDK verification.
- Turbo cache may still replay task results; targeted obligations encourage direct integration commands for high-risk areas.
- Full repository Prettier is not run (changed supported files only).
- Windows CRLF baseline behavior matches `verify:quick` / `verify:changed` (see DEVELOPMENT_GATES).

## CI responsibilities

GitHub Actions continues to run the full verify job, compose smoke, and release workflows. `verify:branch` is an incremental local gate aligned with that matrix, not a second full-repo pipeline.
