/**
 * M20.7.4 — Anthropic Messages API contract notes (offline reference).
 *
 * Installed SDK: @anthropic-ai/sdk 0.74.0 (see adapters/model-anthropic/package.json).
 * OSVA wire version: {@link ANTHROPIC_MESSAGES_API_VERSION} from anthropic-provider-adapter.
 *
 * SDK 0.74.x defaults (when defaultHeaders are not set):
 * - anthropic-version: 2023-06-01 (legacy Messages surface)
 * - No countTokens helper in this SDK line (use raw POST /v1/messages/count_tokens for diagnostics)
 *
 * OSVA overrides via Anthropic client defaultHeaders:
 * - anthropic-version: 2026-10-21
 * - Optional anthropic-workspace-id for multi-workspace / identity-linked keys
 *
 * Fields OSVA sends on messages.create (Builder structured output path):
 * - model, max_tokens, messages, optional system, output_config.format (json_schema + projected schema)
 * - Does NOT send removed/legacy 2026-10-21-incompatible fields (output_format, temperature, top_p, top_k, etc.)
 *
 * Official pairing (Anthropic migration docs): API 2026-10-21 + structured output_config aligns with
 * TypeScript SDK >= 1.0.0. OSVA stays on 0.74.0 until a wire-level defect is proven; version header
 * is set explicitly and wire tests assert output_config on the outbound body.
 *
 * count_tokens: accepts model, system, messages, output_config (same shape as Messages create minus
 * generation-only fields such as max_tokens). Token count success does NOT prove json_schema grammar compilation.
 *
 * Raw Messages diagnostic (operator-only, bypasses @anthropic-ai/sdk): POST /v1/messages
 * with the canonical create body from anthropic-messages-create-body. Known SDK extras not
 * sent on the raw path: User-Agent and Stainless telemetry headers. Version + workspace
 * headers are set explicitly on both paths. HTTP 200 on the raw path does not prove
 * Builder proposal validation.
 */
export const ANTHROPIC_SDK_PACKAGE_VERSION_PIN = "0.74.0" as const;

export const ANTHROPIC_MESSAGES_HTTP_PATH = "/v1/messages" as const;

export const ANTHROPIC_COUNT_TOKENS_HTTP_PATH =
  "/v1/messages/count_tokens" as const;
