# Repository Structure

Planned public monorepo:

```text
apps/
  web/
  worker/
  scheduler/
  workflow-orchestrator/

packages/
  domain/
  contracts/
  db/
  orchestration/
  runtime-core/
  runtime-protocol/
  model-gateway/
  tool-gateway/
  observability/
  sdk/
  cli/

sdks/
  python/

examples/
  remote-runtime-node/
  remote-runtime-python/

adapters/
  queue-bullmq/
  runtime-node/
  model-openai/
  secrets-env/
  telemetry-otel/

examples/
docs/
```

Core packages must not import adapter packages.

The application composition root wires contracts to adapters.
