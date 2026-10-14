# M9.7B production acceptance harness

Version-controlled, disposable real-stack acceptance for OSVA Community (M9.7B.1 slice).

## Run locally

```bash
pnpm acceptance:m9-7b
pnpm acceptance:m9-7b -- --list
pnpm acceptance:m9-7b -- --scenario=health --scenario=agent-run
pnpm acceptance:m9-7b -- --retain
```

## Prerequisites

- Node 24+ and `pnpm install`
- Docker Desktop / Docker Engine (`docker info` succeeds)
- Does **not** use the repo root `docker-compose.yml` volumes or default dev ports

Evidence is written under `.acceptance-evidence/<runId>/` (gitignored).

## CI integration (design)

| Target | Recommendation |
|--------|----------------|
| PR CI (`ci.yml`) | **Do not** add by default (runtime + Docker cost) |
| Release Readiness | Optional job after `verify-core`, running `pnpm acceptance:m9-7b` on `ubuntu-latest` |
| Scheduled workflow | Nightly `workflow_dispatch` with `--retain` disabled |
| Manual | `workflow_dispatch` input for scenario subset |

Gate production sign-off (M9.7C) on a green acceptance run attached to the release commit artifact.

## Scenarios (B.1)

| Id | Description |
|----|-------------|
| `startup` | Isolated PostgreSQL + Valkey containers |
| `schema` | `migrate` + `migrations:integrity` |
| `health` | `/health` and `/ready` |
| `agent-run` | Web → BullMQ → Worker echo agent run |
| `durable-outcome` | API + PostgreSQL attempt status |
| `fault-valkey-restart` | Representative fault framework check |
| `shutdown` | Graceful web/worker stop |
| `isolation-audit` | No foreign `osva.acceptance.*` containers |

Future M9.7B.2 scenarios (SIGKILL, claim crash, concurrent cancel/enqueue) build on this runner and BullMQ test hooks.
