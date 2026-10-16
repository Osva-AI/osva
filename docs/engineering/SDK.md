# OSVA SDK and CLI (Stage 2.5)

Stage 2.5 adds developer packages (published at **`1.1.0-rc.1`** alongside OSS **`1.0.0`** stable):

- `@osva-ai/sdk` — TypeScript/JavaScript control-plane client and Runtime Protocol V1 runtime helpers
- `@osva-ai/cli` — `osva` CLI built on `@osva-ai/sdk`
- `osva-sdk` — Python package (`import osva` / `from osva import OSVAClient`) with the same responsibilities (published on PyPI at **`1.1.0-rc.1`**)

Packages communicate only with OSVA public HTTP contracts. They do not access PostgreSQL, BullMQ, repositories, or internal application services.

## Node / TypeScript

```ts
import { OsvaClient } from "@osva-ai/sdk";

const client = new OsvaClient({
  baseUrl: process.env.OSVA_BASE_URL!,
  apiKey: process.env.OSVA_API_KEY!,
});

const { workspaceId } = await client.auth.getContext();

const agents = await client.agents.list();
const created = await client.runs.create({
  agentId: "agent-1",
  agentVersionId: "av-1",
  input: { prompt: "hello" },
});
```

Runtime helpers live at `@osva-ai/sdk/runtime`:

```ts
import { createNodeHttpServer, createRuntime } from "@osva-ai/sdk/runtime";

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

client = OSVAClient(base_url="http://127.0.0.1:8080", api_key=os.environ["OSVA_API_KEY"])
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
export OSVA_BASE_URL=http://127.0.0.1:8080
export OSVA_API_KEY=osva_ak_...

osva init my-agent && cd my-agent && npm install && npm run build && npm run manifest
osva validate
osva deploy
osva run --wait --input '{"message":"Hello OSVA"}'

osva agents list
osva runs create --agent-id agent-1 --agent-version-id av-1 --input '{"prompt":"hi"}'
osva workflows run --workflow-version-id wfv-1 --input '{}'
osva --json agents list
```

Precedence: CLI flag > environment variable.

Optional `OSVA_WORKSPACE_ID` is cross-checked against `GET /v1/auth/context` when set.

There is no `osva login` or persistent credential storage. API keys are read from `OSVA_API_KEY` only (no `--api-key` flag).

Agent project workflow details: [`packages/cli/README.md`](../../packages/cli/README.md).

## Shared protocol fixtures

Language-neutral Runtime Protocol V1 fixtures live under `packages/runtime-protocol/fixtures/v1/`. Node and Python tests load the same JSON files to prevent wire-contract drift.

## Publication status

`@osva-ai/sdk`, `@osva-ai/cli`, and related packages are published on the **`1.1.0-rc.1`** release candidate line for early adopters. Stable **`1.0.0`** remains the default production line for self-hosted OSS 1.0. See [`OSS-COMMUNITY-QUICKSTART.md`](../OSS-COMMUNITY-QUICKSTART.md) for install pins and upgrade notes.
