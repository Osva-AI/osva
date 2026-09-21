# Development Gates

The repository owns verification. GitHub CI confirms the same commands; it is
not the first place to discover a failure.

## Standard workflow

```text
During implementation:
pnpm verify:quick

Before asking for review:
pnpm verify:ci:clean

After verification:
review
commit
push

GitHub CI:
confirmation, not first discovery
```

Do not return a successful implementation report unless `pnpm verify:ci:clean`
passes or a concrete environmental limitation is explicitly reported.

## Commands

| Command | When | What it does |
| --- | --- | --- |
| `pnpm verify:doctor` | Anytime | Prints Node, pnpm, Turbo, Python, Git, and Docker diagnostics. Does not install software. |
| `pnpm verify:quick` | Inner loop | Formats **changed** Prettier files only, then cached lint, typecheck, and unit tests. No full build, integration, Python package build, or clean. |
| `pnpm verify:ci` | Same as GitHub `verify` | Fail-fast: format check, lint, typecheck, unit tests, **then** build, integration (including Python SDK runtime E2E), `git diff --check`. Non-mutating. |
| `pnpm verify:python` | Same as GitHub `python-sdk` | From `sdks/python`: Ruff format/check, mypy, pytest, `python -m build`, then clean generated Python artifacts. |
| `pnpm verify:ci:clean` | Before review | Environment check, safe generated-artifact clean, `pnpm install --frozen-lockfile`, Python SDK deps, `verify:ci`, `verify:python`, final clean, `git diff --check`, `git status`. |
| `pnpm db:migrations:verify` | Before review (schema changes) | Read-only verification of locked Drizzle migration history (manifest hashes + journal order). Also run via CI harness tests. |

Typecheck always runs before build. That prevents stale `dist/*.d.ts` from
hiding TypeScript errors.

## What quick checks

Changed files are staged, unstaged, and untracked (not gitignored).

Quick formats only Prettier-supported changed files (`endOfLine: lf`). It then
runs Turbo `lint`, `typecheck`, and `test` with cache. If only a few workspace
packages changed, those packages are filtered; root config changes run the
full cached tasks. Turbo `--affected` is not used because it compares the
current branch to `main`, which is too broad for this repository's inner loop.

Quick is not the final correctness gate.

## What CI checks

Exact `verify:ci` order:

```text
format check
lint
typecheck
unit tests (including harness tests)
build
Python runtime import prerequisite
integration tests
git diff --check
```

Failures stop the remaining stages. Output includes `FAILED STAGE`,
`FAILED COMMAND`, and `EXIT CODE` above the inherited tool output.

## What clean removes

`verify:ci:clean` deletes an allowlist of generated names only:

```text
dist/  build/  coverage/  out/  dist-test/
.turbo/  .cache/  .next/
__pycache__/  .pytest_cache/  .mypy_cache/  .ruff_cache/
*.egg-info/  *.tsbuildinfo
```

It never runs `git clean -xfd`. It never deletes `.git/`, `node_modules/`,
source, fixtures, examples source, SDK source, or environment files.

Dry run:

```text
node scripts/verification/clean-generated.mjs --dry-run
```

## Windows CRLF

Tracked files are LF in git. `.gitattributes` sets `* text=auto eol=lf`.

On an existing Windows checkout with `core.autocrlf=true`, some working-tree
files may still be CRLF. In that case local `verify:ci` skips **full**
`format:check` and instead checks changed files against LF. Linux GitHub CI
always runs the full repository format check.

Changed files are still formatted to LF. Full-repo format skip is reported
explicitly; it is not a silent ignore.

## Python local vs CI 3.11

GitHub uses Python 3.11. Local verification uses the available interpreter if
it is 3.11+. The harness prints:

```text
Local Python: X.Y
CI Python: 3.11
```

It does not install another Python version. CI remains authoritative for 3.11.

## Docker / Compose

Docker is optional for `verify:quick` and `verify:ci`. Absence does not fail
those commands. Integration tests start their own PostgreSQL/Valkey
containers when Docker is available.

`compose-smoke` stays a separate GitHub job. It is not part of `verify:ci`.

## How to interpret failures

1. Read `FAILED STAGE` / `FAILED COMMAND` / `EXIT CODE`.
2. Scroll to that stage's inherited tool output; the wrapper does not hide it.
3. Format/lint/typecheck failures are mechanical — fix before integration.
4. Python runtime import failure means install `python -m pip install -e ./sdks/python` before the E2E.
5. Missing `pnpm` on PATH (common on Windows when Corepack is not enabled):
   run `corepack enable` yourself. The harness may inject a process-local
   shim so Turbo can still find pnpm; it does not run `corepack enable`.

## Future implementation prompts

Use this instead of a long verification checklist:

```text
During implementation, run `pnpm verify:quick` at meaningful checkpoints.

Before completion, run `pnpm verify:ci:clean`.

Do not return a successful implementation report unless the final gate
passes or a concrete environmental limitation is explicitly reported.
```
