# Model provider capability matrix (OSVA implemented)

This matrix documents what **OSVA provider adapters implement today**, not what upstream APIs support in general. Status values:

| Status | Meaning |
|--------|---------|
| **Implemented** | Wired in the adapter and used by ModelGateway |
| **Partial** | Limited paths or normalized fields only |
| **Deferred** | Not implemented in OSVA |

Adapters: `@osva/adapters-model-openai`, `@osva/adapters-model-anthropic`, `@osva/adapters-model-gemini`.

| Capability | OpenAI | Anthropic | Google Gemini |
|------------|--------|-----------|---------------|
| Text generation | Implemented (Responses API; Chat Completions for tools/schema/tool-results) | Implemented (Messages API) | Implemented (`generateContent` HTTP) |
| Tool calling | Implemented (Chat Completions path) | Implemented | Implemented |
| Structured JSON output | Implemented (Chat `json_schema`; Responses path not for schema) | Implemented (`output_config.format`) | Implemented (`responseJsonSchema` projection) |
| Provider-reported model identity | Implemented (`response.model` / chat `model` → `invocation.providerReportedModelId`) | Implemented (`message.model`) | Implemented (`modelVersion`) |
| Response / request ID | Implemented (`providerRequestId`, sanitized) | Implemented (`message.id`) | Implemented (`responseId`) |
| Input / output usage | Implemented | Implemented | Implemented |
| Cached-input usage reporting | Implemented (Responses + Chat details) | Implemented (`cache_read_input_tokens` subset) | Implemented (`cachedContentTokenCount` subset of `promptTokenCount`) |
| Cache-write usage reporting | Partial (OpenAI cache-write breakdown not normalized) | Implemented (`cacheWriteInputTokens` from `cache_creation_input_tokens`) | Deferred (no distinct write field normalized) |
| Native prompt-cache configuration | Deferred | Deferred | Deferred |
| Streaming | Deferred | Deferred | Deferred |
| Native asynchronous batch | Deferred | Deferred | Deferred |
| Retry behavior | OpenAI SDK default **2** retries (`OPENAI_SDK_MAX_RETRIES`); connection-resolved adapters use **0** | SDK retries **disabled** (`ANTHROPIC_SDK_MAX_RETRIES = 0`) | No SDK; single HTTP attempt per call |

## Usage normalization notes

- **OpenAI:** `inputTokens` = provider input/prompt total; `cachedInputTokens` is a subset from token details when present.
- **Anthropic:** `inputTokens` = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`; cache read/write are subsets.
- **Gemini:** `promptTokenCount` already includes cached prompt tokens; `cachedInputTokens` must not be added again. Output = `candidatesTokenCount + thoughtsTokenCount`; prefer `totalTokenCount` when consistent.

Internal provenance lives on `ProviderGenerateTextResult.invocation` and is **not** part of the public `GenerateTextResult` contract (F0.1+).

## Related docs

- [Model call flow](./flows/model-call.md)
- Adapters under `adapters/model-openai`, `adapters/model-anthropic`, `adapters/model-gemini`