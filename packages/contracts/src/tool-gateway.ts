import type {
  AgentId,
  ConnectorVersionId,
  RunAttemptId,
  RunId,
  ToolVersionId,
  WorkspaceId,
} from "./ids.js";
import type { JsonSchemaRecord } from "./json-schema.js";
import type { JsonValue } from "./json-value.js";

export const TOOL_BINDING_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const INTERNAL_TOOL_IMPLEMENTATIONS = [
  "OSVA_ECHO_V1",
  "OSVA_CLOCK_NOW_V1",
] as const;

export type InternalToolImplementationId =
  (typeof INTERNAL_TOOL_IMPLEMENTATIONS)[number];

export const TOOL_TYPES = ["INTERNAL", "MCP"] as const;

export type ToolType = (typeof TOOL_TYPES)[number];

export const MCP_TOOL_IMPLEMENTATION = "MCP_V1" as const;

export type McpToolImplementationId = typeof MCP_TOOL_IMPLEMENTATION;

export interface McpToolVersionConfig {
  readonly connectorVersionId: ConnectorVersionId;
  readonly remoteToolName: string;
  readonly description?: string;
  readonly inputSchema: JsonSchemaRecord;
}

export const TOOL_EFFECT_CLASSIFICATIONS = ["READ_ONLY"] as const;

export type ToolEffectClassification =
  (typeof TOOL_EFFECT_CLASSIFICATIONS)[number];

export const TOOL_ERROR_CODES = {
  TOOL_BINDING_NOT_FOUND: "TOOL_BINDING_NOT_FOUND",
  TOOL_VERSION_NOT_FOUND: "TOOL_VERSION_NOT_FOUND",
  TOOL_NOT_AUTHORIZED: "TOOL_NOT_AUTHORIZED",
  TOOL_IMPLEMENTATION_NOT_FOUND: "TOOL_IMPLEMENTATION_NOT_FOUND",
  INVALID_TOOL_INPUT: "INVALID_TOOL_INPUT",
  TOOL_EXECUTION_ERROR: "TOOL_EXECUTION_ERROR",
  INVALID_TOOL_OUTPUT: "INVALID_TOOL_OUTPUT",
  CONNECTOR_UNAVAILABLE: "CONNECTOR_UNAVAILABLE",
  CONNECTOR_AUTHENTICATION_FAILED: "CONNECTOR_AUTHENTICATION_FAILED",
  CONNECTOR_TIMEOUT: "CONNECTOR_TIMEOUT",
  CONNECTOR_CANCELLED: "CONNECTOR_CANCELLED",
  MCP_PROTOCOL_ERROR: "MCP_PROTOCOL_ERROR",
  MCP_TOOL_NOT_FOUND: "MCP_TOOL_NOT_FOUND",
  MCP_INVALID_ARGUMENTS: "MCP_INVALID_ARGUMENTS",
  MCP_TOOL_ERROR: "MCP_TOOL_ERROR",
  MCP_INVALID_RESPONSE: "MCP_INVALID_RESPONSE",
  MCP_UNSUPPORTED_INTERACTION: "MCP_UNSUPPORTED_INTERACTION",
} as const;

export type ToolErrorCode =
  (typeof TOOL_ERROR_CODES)[keyof typeof TOOL_ERROR_CODES];

export function isToolBindingName(value: string): boolean {
  return TOOL_BINDING_NAME_PATTERN.test(value);
}

export function isToolType(value: string): value is ToolType {
  return (TOOL_TYPES as readonly string[]).includes(value);
}

export function isInternalToolImplementationId(
  value: string,
): value is InternalToolImplementationId {
  return (INTERNAL_TOOL_IMPLEMENTATIONS as readonly string[]).includes(value);
}

export function isToolErrorCode(value: string): value is ToolErrorCode {
  return (Object.values(TOOL_ERROR_CODES) as readonly string[]).includes(value);
}

export interface ToolAuthorizationContext {
  readonly workspaceId: WorkspaceId;
  readonly agentId: AgentId;
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly bindingName: string;
  readonly toolVersionId: ToolVersionId;
}

/**
 * Stage 1 ToolGateway request. Authorization context is required for every
 * invocation. The gateway does not derive permissions from prompt text.
 */
export interface ToolInvokeRequest {
  readonly toolVersionId: ToolVersionId;
  readonly input: unknown;
  readonly idempotencyKey?: string;
  readonly authorization: ToolAuthorizationContext;
}

export interface ToolPolicy {
  authorizeToolInvocation(
    context: ToolAuthorizationContext,
  ): Promise<void> | void;
}

export interface ToolGateway {
  invoke(request: ToolInvokeRequest): Promise<JsonValue>;
}
