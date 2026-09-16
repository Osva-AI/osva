import type { JsonValue } from "@osva/contracts";
import {
  RUNTIME_PROTOCOL_ERROR_CODES,
  RUNTIME_PROTOCOL_MAX_BODY_BYTES,
  RUNTIME_PROTOCOL_VERSION,
  runtimeCapabilityCredentialSchema,
  runtimeExecuteRequestSchema,
  type RuntimeExecuteResponse,
} from "@osva/runtime-protocol";

import { CapabilityCredential } from "./capability-credential.js";
import { createRuntimeContext, type RuntimeContext } from "./context.js";
import { RuntimeExecutionError, RuntimeProtocolError } from "./errors.js";

export type RuntimeExecuteFn = (
  input: JsonValue,
  context: RuntimeContext,
) => JsonValue | Promise<JsonValue>;

export interface RuntimeDefinition {
  readonly execute: RuntimeExecuteFn;
}

export interface RuntimeHandlerOptions {
  readonly fetch?: typeof fetch;
  readonly capabilityTimeoutMs?: number;
}

export interface RuntimeHandler {
  handleExecuteRequest(body: unknown): Promise<RuntimeExecuteResponse>;
}

export function createRuntime(definition: {
  execute: RuntimeExecuteFn;
}): RuntimeDefinition {
  return definition;
}

export function createRuntimeHandler(
  runtime: RuntimeDefinition,
  options: RuntimeHandlerOptions = {},
): RuntimeHandler {
  return {
    handleExecuteRequest: (body) =>
      dispatchExecuteRequest(runtime, body, options),
  };
}

async function dispatchExecuteRequest(
  runtime: RuntimeDefinition,
  body: unknown,
  options: RuntimeHandlerOptions,
): Promise<RuntimeExecuteResponse> {
  const parsed = runtimeExecuteRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new RuntimeProtocolError(
      "Invalid Runtime Protocol V1 execute request.",
      RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
    );
  }

  if (parsed.data.protocolVersion !== RUNTIME_PROTOCOL_VERSION) {
    throw new RuntimeProtocolError(
      `Unsupported protocol version: ${parsed.data.protocolVersion}.`,
      RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
    );
  }

  const credentialParsed = runtimeCapabilityCredentialSchema.safeParse(
    parsed.data.capabilities,
  );
  if (!credentialParsed.success) {
    throw new RuntimeProtocolError(
      "Invalid capability credential in execute request.",
      RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
    );
  }

  const credential = new CapabilityCredential(
    credentialParsed.data.endpoint,
    credentialParsed.data.token,
  );
  const context = createRuntimeContext({
    executionId: parsed.data.executionId,
    credential,
    fetch: options.fetch,
    timeoutMs: options.capabilityTimeoutMs,
  });

  try {
    const output = await runtime.execute(
      parsed.data.input as JsonValue,
      context,
    );
    return {
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      executionId: parsed.data.executionId,
      outcome: "SUCCEEDED",
      output,
    };
  } catch (error) {
    const message =
      error instanceof RuntimeExecutionError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Agent execution failed.";
    const code =
      error instanceof RuntimeExecutionError
        ? error.code
        : RUNTIME_PROTOCOL_ERROR_CODES.AGENT_EXECUTION_FAILED;

    return {
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      executionId: parsed.data.executionId,
      outcome: "FAILED",
      error: {
        code,
        message: sanitizeErrorMessage(message),
      },
    };
  }
}

function sanitizeErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return "Agent execution failed.";
  }
  return trimmed.slice(0, 500);
}

export { RUNTIME_PROTOCOL_MAX_BODY_BYTES };
