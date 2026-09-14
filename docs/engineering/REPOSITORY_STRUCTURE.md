# Repository Structure

Planned public monorepo:

```text
apps/
  web/
  worker/
  cli/

packages/
  domain/
  contracts/
  db/
  api/
  orchestration/
  runtime-core/
  model-gateway/
  tool-gateway/
  evaluation/
  observability/
  policy-core/
  sdk/
  shared/

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
