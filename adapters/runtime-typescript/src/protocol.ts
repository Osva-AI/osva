import type { JsonValue } from "@osva/contracts";

import { TRUSTED_RUNTIME_IPC_VERSION } from "./constants.js";

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

  const error = record.error;
  if (error === null || typeof error !== "object") {
    return false;
  }

  const errorRecord = error as Record<string, unknown>;
  return (
    typeof errorRecord.code === "string" &&
    errorRecord.code.length > 0 &&
    typeof errorRecord.message === "string" &&
    errorRecord.message.length > 0
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
