/** Sanitized Anthropic invalid_request_error classifications for ModelGateway. */
export const ANTHROPIC_CLASSIFIED_INVALID_REQUEST_CODES = [
  "workspace_selection_required",
  "workspace_selection_invalid",
  "organization_spend_limit",
  "compiled_grammar_too_large",
  "schema_too_complex",
  "unsupported_schema_feature",
  "unsupported_parameter",
  "malformed_message",
  "other_invalid_request",
  "unrecognized_request",
] as const;

export type AnthropicClassifiedInvalidRequestCode =
  (typeof ANTHROPIC_CLASSIFIED_INVALID_REQUEST_CODES)[number];
