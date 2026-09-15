# Implementation Tracker

Status is recorded after locally verifiable checks for each slice.

## Stage 0

- ✅ 0.1 Monorepo, packages, and public contracts
- ✅ 0.2 Domain model and state machines
- ✅ 0.3 Memory adapters and fakes
- ✅ 0.4 JobQueue and RuntimeAdapter test adapters
- ✅ 0.5 PostgreSQL persistence
- ✅ 0.6 Orchestration and runtime-core walking skeleton
- ✅ 0.7 Web and Worker process shells
- 🟡 0.8 Local Infrastructure, CI, and Stage 0 Acceptance

Slice 0.8 stays yellow until the GitHub Actions `compose-smoke` job has actually
run successfully. Docker is not on PATH on the implementing machine, so local
Compose execution remains unverified.

Locally executed quality gates can pass without Docker. The Compose topology,
Valkey health, migrate-against-Compose, `/health`, `/ready`, and worker
start/shutdown are accepted only after `compose-smoke` succeeds on GitHub.

## Later stages

Stage 1+ work is out of scope for this tracker until Stage 0 is accepted.
