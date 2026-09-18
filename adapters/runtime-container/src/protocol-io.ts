import {
  RUNTIME_PROTOCOL_ERROR_CODES,
  RUNTIME_PROTOCOL_MAX_BODY_BYTES,
  RUNTIME_PROTOCOL_VERSION,
  runtimeExecuteResponseSchema,
  type RuntimeExecuteRequest,
  type RuntimeExecuteResponse,
} from "@osva/runtime-protocol";

import { CONTAINER_PROTOCOL_STDOUT_MAX_BYTES } from "./output-limits.js";

export interface ParsedContainerProtocolResponse {
  readonly response: RuntimeExecuteResponse;
}

export type ContainerProtocolParseFailureReason =
  | "stdout_exceeds_limit"
  | "empty_stdout"
  | "multiple_stdout_messages"
  | "invalid_json"
  | "invalid_response"
  | "unsupported_protocol_version"
  | "mismatched_execution_id";

export class ContainerProtocolParseError extends Error {
  constructor(readonly reason: ContainerProtocolParseFailureReason) {
    super(reason);
    this.name = "ContainerProtocolParseError";
  }
}

export function formatRuntimeExecuteRequestPayload(
  request: RuntimeExecuteRequest,
): string {
  return `${JSON.stringify(request)}\n`;
}

export function parseContainerProtocolStdout(
  stdout: string,
  executionId: string,
  options: {
    readonly stdoutByteLength: number;
    readonly stdoutTruncated: boolean;
  },
): ParsedContainerProtocolResponse {
  if (
    options.stdoutTruncated ||
    options.stdoutByteLength > CONTAINER_PROTOCOL_STDOUT_MAX_BYTES
  ) {
    throw new ContainerProtocolParseError("stdout_exceeds_limit");
  }

  const normalized = stdout.replace(/^\uFEFF/, "");
  const newlineIndex = normalized.indexOf("\n");
  const firstLine =
    newlineIndex >= 0
      ? normalized.slice(0, newlineIndex).trim()
      : normalized.trim();

  if (newlineIndex >= 0) {
    const remainder = normalized.slice(newlineIndex + 1).trim();
    if (remainder.length > 0) {
      throw new ContainerProtocolParseError("multiple_stdout_messages");
    }
  }

  if (firstLine.length === 0) {
    throw new ContainerProtocolParseError("empty_stdout");
  }

  if (Buffer.byteLength(firstLine, "utf8") > RUNTIME_PROTOCOL_MAX_BODY_BYTES) {
    throw new ContainerProtocolParseError("stdout_exceeds_limit");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(firstLine);
  } catch {
    throw new ContainerProtocolParseError("invalid_json");
  }

  const parsed = runtimeExecuteResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new ContainerProtocolParseError("invalid_response");
  }

  if (parsed.data.protocolVersion !== RUNTIME_PROTOCOL_VERSION) {
    throw new ContainerProtocolParseError("unsupported_protocol_version");
  }

  if (parsed.data.executionId !== executionId) {
    throw new ContainerProtocolParseError("mismatched_execution_id");
  }

  return { response: parsed.data };
}

export function protocolFailureMessage(
  reason: ContainerProtocolParseFailureReason,
): string {
  switch (reason) {
    case "stdout_exceeds_limit":
      return "Container runtime response exceeds the maximum protocol body size.";
    case "empty_stdout":
      return "Container runtime returned an empty protocol response.";
    case "multiple_stdout_messages":
      return "Container runtime stdout must contain exactly one protocol response.";
    case "invalid_json":
      return "Container runtime returned invalid JSON.";
    case "invalid_response":
      return "Container runtime returned an invalid protocol response.";
    case "unsupported_protocol_version":
      return "Container runtime returned an unsupported protocol version.";
    case "mismatched_execution_id":
      return "Container runtime returned a mismatched executionId.";
  }
}

export function protocolFailureCode(): string {
  return RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE;
}
