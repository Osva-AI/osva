import type {
  GenerateTextInput,
  GenerateTextResult,
  JsonValue,
} from "@osva/contracts";

import type { RuntimeProtocolVersion } from "./constants.js";

export interface RuntimeProtocolError {
  readonly code: string;
  readonly message: string;
}

export interface RuntimeCapabilityCredential {
  readonly endpoint: string;
  readonly token: string;
}

export interface RuntimeExecuteRequest {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly input: JsonValue;
  readonly capabilities: RuntimeCapabilityCredential;
}

export interface RuntimeExecuteSuccess {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly outcome: "SUCCEEDED";
  readonly output: JsonValue;
}

export interface RuntimeExecuteFailure {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly outcome: "FAILED";
  readonly error: RuntimeProtocolError;
}

export type RuntimeExecuteResponse =
  RuntimeExecuteSuccess | RuntimeExecuteFailure;

export interface RuntimeModelGenerateTextRequest {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly bindingName: string;
  readonly input: GenerateTextInput;
}

export interface RuntimeModelGenerateTextSuccess {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly outcome: "SUCCEEDED";
  readonly result: GenerateTextResult;
}

export interface RuntimeModelGenerateTextFailure {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly outcome: "FAILED";
  readonly error: RuntimeProtocolError;
}

export type RuntimeModelGenerateTextResponse =
  RuntimeModelGenerateTextSuccess | RuntimeModelGenerateTextFailure;

export interface RuntimeToolInvokeRequest {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly bindingName: string;
  readonly input: JsonValue;
  readonly idempotencyKey?: string;
}

export interface RuntimeToolInvokeSuccess {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly outcome: "SUCCEEDED";
  readonly output: JsonValue;
}

export interface RuntimeToolInvokeFailure {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly outcome: "FAILED";
  readonly error: RuntimeProtocolError;
}

export type RuntimeToolInvokeResponse =
  RuntimeToolInvokeSuccess | RuntimeToolInvokeFailure;
