# OSVA SDK and CLI (Stage 2.5)

Stage 2.5 adds publish-ready (but not yet published) developer packages:

- `@osva/sdk` — TypeScript/JavaScript control-plane client and Runtime Protocol V1 runtime helpers
- `@osva/cli` — `osva` CLI built on `@osva/sdk`
- `osva-sdk` — Python package (`import osva`) with the same responsibilities

Packages communicate only with OSVA public HTTP contracts. They do not access PostgreSQL, BullMQ, repositories, or internal application services.

## Node / TypeScript

```ts
import { OsvaClient } from "@osva/sdk";

const client = new OsvaClient({
  baseUrl: "http://127.0.0.1:3000",
  workspaceId: "ws-dev",
});

const agents = await client.agents.list();
const created = await client.runs.create({
  agentId: "agent-1",
  agentVersionId: "av-1",
  input: { prompt: "hello" },
});
```

Runtime helpers live at `@osva/sdk/runtime`:

```ts
import { createNodeHttpServer, createRuntime } from "@osva/sdk/runtime";

const runtime = createRuntime({
  async execute(input, context) {
    // executionId is opaque runtime idempotency identity (RunAttemptId on the wire)
    const result = await context.models.generateText({
      binding: "primary",
      messages: [{ role: "user", content: "hello" }],
    });
    return { text: result.text };
  },
});

createNodeHttpServer(runtime).listen(8080);
```

## Python

Requires Python >= 3.11.

```python
from osva import OSVAClient

client = OSVAClient(base_url="http://127.0.0.1:3000", workspace_id="ws-dev")
agents = client.agents.list()
```

Runtime helpers:

```python
from osva.runtime import Runtime

runtime = Runtime()

@runtime.execute
async def execute(input, context):
    result = await context.models.generate_text(
        binding="primary",
        messages=[{"role": "user", "content": "hello"}],
    )
    return {"text": result["text"]}

app = runtime.asgi_app()  # serve with uvicorn/hypercorn
```

## RuntimeContext

Both runtimes expose a narrow execution context:

- `executionId` — opaque idempotency identity; durable dedupe is the implementer's responsibility
- `models.generateText` / `models.generate_text` — OSVA-controlled model bindings
- `tools.invoke` — OSVA-controlled tool bindings

Capability tokens, workspace IDs, Run objects, provider credentials, and ToolVersion / ModelProfileVersion IDs are not exposed.

## CLI

```bash
export OSVA_BASE_URL=http://127.0.0.1:3000
export OSVA_WORKSPACE_ID=ws-dev

osva agents list
osva runs create --agent-id agent-1 --agent-version-id av-1 --input '{"prompt":"hi"}'
osva workflows run --workflow-version-id wfv-1 --input '{}'
osva --json agents list
```

Precedence: CLI flag > environment variable.

There is no `osva login` or persistent credential storage in Slice 2.5.

## Shared protocol fixtures

Language-neutral Runtime Protocol V1 fixtures live under `packages/runtime-protocol/fixtures/v1/`. Node and Python tests load the same JSON files to prevent wire-contract drift.

## Publication status

Packages are structured for publication but are **not** published to npm or PyPI in Stage 2.5.
