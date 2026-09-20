export const RUNTIME_PROTOCOL_VERSION = "1" as const;

export type RuntimeProtocolVersion = typeof RUNTIME_PROTOCOL_VERSION;

/**
 * Maximum Runtime Protocol V1 request/response body size, including
 * capability payloads. Matches a conservative JSON-safe HTTP bound.
 */
export const RUNTIME_PROTOCOL_MAX_BODY_BYTES = 1_048_576;

export const RUNTIME_PROTOCOL_ERROR_CODES = {
  TRANSPORT_FAILURE: "RUNTIME_TRANSPORT_FAILURE",
  PROTOCOL_FAILURE: "RUNTIME_PROTOCOL_FAILURE",
  AGENT_EXECUTION_FAILED: "AGENT_EXECUTION_FAILED",
  UNSUPPORTED_RUNTIME: "UNSUPPORTED_RUNTIME",
  CAPABILITY_UNAUTHORIZED: "CAPABILITY_UNAUTHORIZED",
} as const;

export type RuntimeProtocolErrorCode =
  (typeof RUNTIME_PROTOCOL_ERROR_CODES)[keyof typeof RUNTIME_PROTOCOL_ERROR_CODES];

export const RUNTIME_PROTOCOL_OUTCOMES = ["SUCCEEDED", "FAILED"] as const;

export type RuntimeProtocolOutcome = (typeof RUNTIME_PROTOCOL_OUTCOMES)[number];

export const RUNTIME_CAPABILITY_PATHS = {
  executionBootstrap: "/v1/runtime/executions/bootstrap",
  generateText: "/v1/runtime/capabilities/models/generate-text",
  invokeTool: "/v1/runtime/capabilities/tools/invoke",
  memoryGet: "/v1/runtime/capabilities/memory/get",
  memorySet: "/v1/runtime/capabilities/memory/set",
  memoryDelete: "/v1/runtime/capabilities/memory/delete",
  memoryList: "/v1/runtime/capabilities/memory/list",
  artifactGet: "/v1/runtime/capabilities/artifacts/get",
  artifactCreate: "/v1/runtime/capabilities/artifacts/create",
  artifactContent: "/v1/runtime/capabilities/artifacts/content",
} as const;
