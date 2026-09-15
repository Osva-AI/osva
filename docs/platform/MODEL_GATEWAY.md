# Model Gateway

ModelProfiles are stable control-plane identities (`id`, `workspaceId`, `key`,
`name`, `createdAt`). Only `name` is mutable. There is no deletion and no
mutable current-version pointer.

ModelProfileVersions are immutable append-only snapshots (`id`,
`modelProfileId`, `version`, `provider`, `model`, `createdAt`). Version numbers
are server-assigned positive integers, unique per ModelProfile. The first
supported provider is `OPENAI`. `model` is the provider model identifier. OSVA
does not store credentials or provider SDK request objects on these records.

Production ModelProfileVersions should prefer provider snapshot IDs where
available. Aliases remain valid but are less reproducible.

`@osva/model-gateway` loads the immutable ModelProfileVersion and routes
`generateText` to a provider adapter. Provider SDK types stay inside the
adapter. Stage 1 ships `@osva/adapters-model-openai`, which calls the OpenAI
Responses API (`store: false` for these stateless calls). The official OpenAI
Node SDK's default `maxRetries` is 2; those retries stay inside one
`generateText` call and are not OSVA RunAttempts. OSVA does not add its own
provider retry policy or fallback.

`OPENAI_API_KEY` is read only when composing the worker. It is never persisted
and never copied into trusted agent child processes. The worker starts without
it; OPENAI bindings then fail with `MODEL_PROVIDER_UNAVAILABLE`.

Trusted TypeScript agents call `context.models.generateText(bindingName,
request)` and receive `{ text }`. They do not select providers or models.
Outstanding provider calls are aborted internally when the trusted child
times out, exits, or the runtime closes. That `AbortSignal` is an execution
option on ModelGateway, not part of the public request contract or IPC.

Stage 1 does not implement streaming, tools, structured output, vision, audio,
embeddings, usage accounting, cost, budgets, or additional providers.
