# Container Runtime Python Example

Minimal `CONTAINER` agent for OSVA Stage 3.1.

## Protocol contract

Runtime Protocol V1 defines schemas and execution semantics. This example uses
CONTAINER transport:

```text
bootstrap GET → RuntimeExecuteRequest V1 (once)
stdout          → exactly one RuntimeExecuteResponse JSON line
stderr          → diagnostics only
```

Environment (injected by `ContainerRuntimeAdapter`):

```text
OSVA_EXECUTION_ID
OSVA_RUNTIME_BOOTSTRAP_URL
OSVA_RUNTIME_BOOTSTRAP_TOKEN
```

The example performs one authenticated bootstrap GET, then reuses the Python SDK
runtime helpers for capability calls. Capability endpoint and token arrive in
the bootstrapped RuntimeExecuteRequest payload—not from worker secrets in the
environment.

## Supported input modes

| `input.mode` | Behavior |
|---|---|
| `echo` | Echo input as output |
| `sleep` | Sleep for `input.seconds` then return |
| `tool` | Invoke a bound tool through the capability bridge |
| `fail` | Raise an agent execution failure |
| `bad_stdout` | Write diagnostics to stdout (protocol violation test helper) |

## Build a digest-pinned local image

```bash
docker build -t osva-container-runtime-python:local examples/container-runtime-python
docker image inspect --format '{{.Id}}' osva-container-runtime-python:local
```

Use an AgentVersion runtime image reference in OSVA canonical form:

```text
osva-container-runtime-python@sha256:<64-hex>
```

Strip the `sha256:` prefix from Docker's image ID and append it after `@sha256:`.

## Local worker configuration

Container bridge networking is operator-owned. A bridge container cannot reach a
capability server advertised on `http://127.0.0.1`.

Typical local settings:

```text
OSVA_CONTAINER_ENABLED=true
OSVA_RUNTIME_CAPABILITY_SECRET=<secret>
OSVA_CONTAINER_NETWORK_MODE=bridge
OSVA_CONTAINER_CAPABILITY_BASE_URL=http://host.docker.internal:<port>
```

On Linux Docker Engine, `host.docker.internal` may be unavailable unless
explicitly configured. Use the docker0 bridge gateway (often `172.17.0.1`) or
set `extra_hosts` in your local Docker setup.

Formal outbound egress firewalling is deferred to Stage 3.7.
