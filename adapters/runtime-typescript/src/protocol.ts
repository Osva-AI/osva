import type {
  GenerateTextInput,
  GenerateTextResult,
  JsonValue,
} from "@osva/contracts";

import {
  MODEL_MAX_OUTPUT_TOKENS_MAX,
  MODEL_MAX_OUTPUT_TOKENS_MIN,
  MODEL_TEXT_CONTENT_MAX_LENGTH,
  MODEL_TEXT_MAX_MESSAGES,
  MODEL_TEXT_ROLES,
  TRUSTED_RUNTIME_IPC_VERSION,
  isModelBindingName,
  isToolBindingName,
} from "./constants.js";

export interface TrustedAgentContext {
  readonly input: unknown;
  readonly runId: string;
  readonly runAttemptId: string;
  readonly workspaceId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
}

export interface ExecuteChildRequest {
  readonly v: typeof TRUSTED_RUNTIME_IPC_VERSION;
  readonly type: "execute";
  readonly modulePath: string;
  readonly context: TrustedAgentContext;
}

export interface ChildSuccessMessage {
  readonly v: typeof TRUSTED_RUNTIME_IPC_VERSION;
  readonly type: "succeeded";
  readonly output: JsonValue;
}

export interface ChildFailureMessage {
  readonly v: typeof TRUSTED_RUNTIME_IPC_VERSION;
  readonly type: "failed";
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export type ChildResultMessage = ChildSuccessMessage | ChildFailureMessage;

export interface ModelGenerateRequestMessage {
  readonly v: typeof TRUSTED_RUNTIME_IPC_VERSION;
  readonly type: "model.generate.request";
  readonly callId: string;
  readonly binding: string;
  readonly request: GenerateTextInput;
}

export interface ModelGenerateSucceededMessage {
  readonly v: typeof TRUSTED_RUNTIME_IPC_VERSION;
  readonly type: "model.generate.succeeded";
  readonly callId: string;
  readonly result: GenerateTextResult;
}

export interface ModelGenerateFailedMessage {
  readonly v: typeof TRUSTED_RUNTIME_IPC_VERSION;
  readonly type: "model.generate.failed";
  readonly callId: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export type ParentToChildModelMessage =
  ModelGenerateSucceededMessage | ModelGenerateFailedMessage;

export interface ToolInvokeRequestMessage {
  readonly v: typeof TRUSTED_RUNTIME_IPC_VERSION;
  readonly type: "tool.invoke.request";
  readonly callId: string;
  readonly binding: string;
  readonly input: unknown;
  readonly idempotencyKey?: string;
}

export interface ToolInvokeSucceededMessage {
  readonly v: typeof TRUSTED_RUNTIME_IPC_VERSION;
  readonly type: "tool.invoke.succeeded";
  readonly callId: string;
  readonly output: JsonValue;
}

export interface ToolInvokeFailedMessage {
  readonly v: typeof TRUSTED_RUNTIME_IPC_VERSION;
  readonly type: "tool.invoke.failed";
  readonly callId: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export type ParentToChildToolMessage =
  ToolInvokeSucceededMessage | ToolInvokeFailedMessage;

export function isExecuteChildRequest(
  value: unknown,
): value is ExecuteChildRequest {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.v === TRUSTED_RUNTIME_IPC_VERSION &&
    record.type === "execute" &&
    typeof record.modulePath === "string" &&
    record.modulePath.length > 0 &&
    isTrustedAgentContext(record.context)
  );
}

export function isChildResultMessage(
  value: unknown,
): value is ChildResultMessage {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.v !== TRUSTED_RUNTIME_IPC_VERSION) {
    return false;
  }

  if (record.type === "succeeded") {
    return "output" in record;
  }

  if (record.type !== "failed") {
    return false;
  }

  return isNamedError(record.error);
}

export function isModelGenerateRequestMessage(
  value: unknown,
): value is ModelGenerateRequestMessage {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.v === TRUSTED_RUNTIME_IPC_VERSION &&
    record.type === "model.generate.request" &&
    isNonEmptyString(record.callId) &&
    typeof record.binding === "string" &&
    isModelBindingName(record.binding) &&
    isGenerateTextInput(record.request)
  );
}

export function isModelGenerateSucceededMessage(
  value: unknown,
): value is ModelGenerateSucceededMessage {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (
    record.v !== TRUSTED_RUNTIME_IPC_VERSION ||
    record.type !== "model.generate.succeeded" ||
    !isNonEmptyString(record.callId)
  ) {
    return false;
  }

  const result = record.result;
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return false;
  }

  const resultRecord = result as Record<string, unknown>;
  return typeof resultRecord.text === "string";
}

export function isModelGenerateFailedMessage(
  value: unknown,
): value is ModelGenerateFailedMessage {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.v === TRUSTED_RUNTIME_IPC_VERSION &&
    record.type === "model.generate.failed" &&
    isNonEmptyString(record.callId) &&
    isNamedError(record.error)
  );
}

export function isParentToChildModelMessage(
  value: unknown,
): value is ParentToChildModelMessage {
  return (
    isModelGenerateSucceededMessage(value) ||
    isModelGenerateFailedMessage(value)
  );
}

export function isToolInvokeRequestMessage(
  value: unknown,
): value is ToolInvokeRequestMessage {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (
    record.v !== TRUSTED_RUNTIME_IPC_VERSION ||
    record.type !== "tool.invoke.request" ||
    !isNonEmptyString(record.callId) ||
    typeof record.binding !== "string" ||
    !isToolBindingName(record.binding)
  ) {
    return false;
  }

  for (const key of Object.keys(record)) {
    if (
      key !== "v" &&
      key !== "type" &&
      key !== "callId" &&
      key !== "binding" &&
      key !== "input" &&
      key !== "idempotencyKey"
    ) {
      return false;
    }
  }

  if (
    record.idempotencyKey !== undefined &&
    !isNonEmptyString(record.idempotencyKey)
  ) {
    return false;
  }

  return true;
}

export function isToolInvokeSucceededMessage(
  value: unknown,
): value is ToolInvokeSucceededMessage {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.v === TRUSTED_RUNTIME_IPC_VERSION &&
    record.type === "tool.invoke.succeeded" &&
    isNonEmptyString(record.callId) &&
    "output" in record
  );
}

export function isToolInvokeFailedMessage(
  value: unknown,
): value is ToolInvokeFailedMessage {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.v === TRUSTED_RUNTIME_IPC_VERSION &&
    record.type === "tool.invoke.failed" &&
    isNonEmptyString(record.callId) &&
    isNamedError(record.error)
  );
}

export function isParentToChildToolMessage(
  value: unknown,
): value is ParentToChildToolMessage {
  return (
    isToolInvokeSucceededMessage(value) || isToolInvokeFailedMessage(value)
  );
}

function isTrustedAgentContext(value: unknown): value is TrustedAgentContext {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [
    "agentId",
    "agentVersionId",
    "input",
    "runAttemptId",
    "runId",
    "workspaceId",
  ];

  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]) &&
    typeof record.runId === "string" &&
    typeof record.runAttemptId === "string" &&
    typeof record.workspaceId === "string" &&
    typeof record.agentId === "string" &&
    typeof record.agentVersionId === "string"
  );
}

function isGenerateTextInput(value: unknown): value is GenerateTextInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "messages" && key !== "maxOutputTokens") {
      return false;
    }
  }

  if (!Array.isArray(record.messages)) {
    return false;
  }

  if (
    record.messages.length < 1 ||
    record.messages.length > MODEL_TEXT_MAX_MESSAGES
  ) {
    return false;
  }

  if (!record.messages.every((message) => isModelTextMessage(message))) {
    return false;
  }

  if (record.maxOutputTokens === undefined) {
    return true;
  }

  return (
    typeof record.maxOutputTokens === "number" &&
    Number.isInteger(record.maxOutputTokens) &&
    record.maxOutputTokens >= MODEL_MAX_OUTPUT_TOKENS_MIN &&
    record.maxOutputTokens <= MODEL_MAX_OUTPUT_TOKENS_MAX
  );
}

function isModelTextMessage(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.role === "string" &&
    (MODEL_TEXT_ROLES as readonly string[]).includes(record.role) &&
    typeof record.content === "string" &&
    record.content.length > 0 &&
    record.content.length <= MODEL_TEXT_CONTENT_MAX_LENGTH
  );
}

function isNamedError(value: unknown): value is {
  readonly code: string;
  readonly message: string;
} {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const errorRecord = value as Record<string, unknown>;
  return (
    typeof errorRecord.code === "string" &&
    errorRecord.code.length > 0 &&
    typeof errorRecord.message === "string" &&
    errorRecord.message.length > 0
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
