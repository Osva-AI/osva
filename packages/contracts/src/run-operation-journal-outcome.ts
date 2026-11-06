import { TOOL_ERROR_CODES } from "./tool-gateway.js";
import type { RunOperationIdempotencyClass } from "./run-operation-journal.js";

export type RunOperationJournalFailureDisposition =
  | { readonly kind: "definitive_failed" }
  | { readonly kind: "uncertain" }
  | { readonly kind: "no_journal_update" };

const DEFINITIVE_PRE_DISPATCH_CODES = new Set<string>([
  TOOL_ERROR_CODES.TOOL_BINDING_NOT_FOUND,
  TOOL_ERROR_CODES.TOOL_VERSION_NOT_FOUND,
  TOOL_ERROR_CODES.TOOL_NOT_AUTHORIZED,
  TOOL_ERROR_CODES.TOOL_IMPLEMENTATION_NOT_FOUND,
  TOOL_ERROR_CODES.INVALID_TOOL_INPUT,
  TOOL_ERROR_CODES.MCP_INVALID_ARGUMENTS,
  TOOL_ERROR_CODES.MCP_TOOL_NOT_FOUND,
]);

const PROVIDER_CONFIRMED_FAILURE_CODES = new Set<string>([
  TOOL_ERROR_CODES.INVALID_TOOL_OUTPUT,
  TOOL_ERROR_CODES.MCP_INVALID_RESPONSE,
]);

const AMBIGUOUS_TRANSPORT_CODES = new Set<string>([
  TOOL_ERROR_CODES.CONNECTOR_UNAVAILABLE,
  TOOL_ERROR_CODES.CONNECTOR_TIMEOUT,
  TOOL_ERROR_CODES.CONNECTOR_CANCELLED,
  TOOL_ERROR_CODES.MCP_PROTOCOL_ERROR,
  TOOL_ERROR_CODES.TOOL_EXECUTION_ERROR,
  TOOL_ERROR_CODES.MCP_TOOL_ERROR,
]);

function readToolErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function resolveRunOperationJournalFailureDisposition(input: {
  readonly idempotencyClass: RunOperationIdempotencyClass;
  readonly error: unknown;
  readonly pendingRecorded: boolean;
}): RunOperationJournalFailureDisposition {
  if (!input.pendingRecorded) {
    return { kind: "no_journal_update" };
  }

  const code = readToolErrorCode(input.error);

  if (code !== undefined && DEFINITIVE_PRE_DISPATCH_CODES.has(code)) {
    return { kind: "no_journal_update" };
  }

  if (
    input.idempotencyClass === "UNKNOWN_WRITE" ||
    input.idempotencyClass === "RECONCILE"
  ) {
    return { kind: "uncertain" };
  }

  if (input.idempotencyClass === "IDEMPOTENT_WRITE") {
    if (code !== undefined && AMBIGUOUS_TRANSPORT_CODES.has(code)) {
      return { kind: "uncertain" };
    }
    if (code !== undefined && PROVIDER_CONFIRMED_FAILURE_CODES.has(code)) {
      return { kind: "uncertain" };
    }
    return { kind: "uncertain" };
  }

  if (input.idempotencyClass === "READ_ONLY") {
    if (code !== undefined && AMBIGUOUS_TRANSPORT_CODES.has(code)) {
      return { kind: "uncertain" };
    }
    return { kind: "definitive_failed" };
  }

  if (input.idempotencyClass === "PURE") {
    return { kind: "definitive_failed" };
  }

  return { kind: "uncertain" };
}
