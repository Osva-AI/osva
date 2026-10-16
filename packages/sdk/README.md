# @osva-ai/sdk

Official TypeScript and JavaScript SDK for the OSVA control plane and Runtime Protocol V1 helpers.

**Node.js:** >= 24.

## Installation

```bash
npm install @osva-ai/sdk@1.1.0-rc.1
```

Peer dependency `@osva-ai/contracts` is installed automatically.

## Control-plane client

Authentication is **API-key only**. The client does not accept `workspaceId` in constructor options; resolve the workspace with `client.auth.getContext()` when needed.

```js
import { OsvaClient, OsvaApiError, OsvaTransportError } from "@osva-ai/sdk";

const baseUrl = process.env.OSVA_BASE_URL;
const apiKey = process.env.OSVA_API_KEY;

if (!baseUrl || !apiKey) {
  throw new Error("OSVA_BASE_URL and OSVA_API_KEY are required");
}

const client = new OsvaClient({
  baseUrl,
  apiKey,
  timeoutMs: 60_000, // optional, default 30s
});

const context = await client.auth.getContext();
console.log(context.workspaceId);

const agents = await client.agents.list();
```

### Agents and Runs

```js
const agent = await client.agents.create({
  key: "my-agent",
  name: "My Agent",
});

const version = await client.agents.createVersion(agent.id, {
  manifest: {
    /* AgentManifestV1 */
  },
});

const created = await client.runs.create({
  agentId: agent.id,
  agentVersionId: version.id,
  input: { message: "Hello OSVA" },
});

const run = await client.runs.get(created.run.id);
const attempt = await client.runs.getAttempt(
  created.run.id,
  created.runAttempt.id,
);
console.log(attempt.status, attempt.output);
```

List versions and reuse an existing immutable version by comparing manifests (see `@osva-ai/cli` deploy logic for the same pattern).

## Errors

- **`OsvaApiError`** — non-2xx JSON error body (`status`, `code`, `message`, `requestId` when present). Message text includes HTTP status, domain status, code, and message when the API provides them.
- **`OsvaTransportError`** — network failure, timeout, or non-JSON response.

The SDK does not automatically retry mutations or HTTP 429 responses.

```js
try {
  await client.agents.list();
} catch (error) {
  if (error instanceof OsvaApiError) {
    console.error(error.status, error.body, error.requestId);
  } else if (error instanceof OsvaTransportError) {
    console.error(error.message);
  }
  throw error;
}
```

## Runtime helpers

Remote runtimes use `@osva-ai/sdk/runtime` (see [SDK engineering doc](../../docs/engineering/SDK.md)).

## CLI

Agent scaffolding and deploy/run workflows are provided by **`@osva-ai/cli`** (`osva init`, `validate`, `deploy`, `run`). The CLI uses this SDK internally.

## Links

- [Engineering SDK doc](../../docs/engineering/SDK.md)
- [Community quickstart](../../docs/OSS-COMMUNITY-QUICKSTART.md)

## License

Apache-2.0
