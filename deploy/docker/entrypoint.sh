#!/bin/sh
set -eu

if [ -n "${OSVA_PROCESS:-}" ]; then
  process="$OSVA_PROCESS"
  set --
elif [ "$#" -gt 0 ]; then
  process="$1"
  shift
else
  process=""
fi

case "$process" in
  web)
    exec node /app/apps/web/dist/main.js "$@"
    ;;
  worker)
    exec node /app/apps/worker/dist/main.js "$@"
    ;;
  scheduler)
    exec node /app/apps/scheduler/dist/main.js "$@"
    ;;
  workflow-orchestrator)
    exec node /app/apps/workflow-orchestrator/dist/main.js "$@"
    ;;
  knowledge-worker)
    exec node /app/apps/knowledge-worker/dist/main.js "$@"
    ;;
  mcp-server)
    exec node /app/apps/mcp-server/dist/main.js "$@"
    ;;
  migrate)
    exec node /app/packages/db/dist/migrate-cli.js "$@"
    ;;
  bootstrap)
    exec node /app/packages/db/dist/bootstrap-cli.js "$@"
    ;;
  "")
    echo "OSVA_PROCESS is required (web, worker, scheduler, workflow-orchestrator, knowledge-worker, mcp-server, migrate, bootstrap)." >&2
    exit 1
    ;;
  *)
    echo "Unknown OSVA_PROCESS: $process" >&2
    exit 1
    ;;
esac
