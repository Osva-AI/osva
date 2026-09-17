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

export interface MemoryRecordView {
  readonly key: string;
  readonly value: JsonValue;
  readonly revision: number;
}

export interface RuntimeMemoryGetRequest {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly bindingName: string;
  readonly key: string;
}

export interface RuntimeMemoryGetSuccess {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly outcome: "SUCCEEDED";
  readonly record: MemoryRecordView;
}

export interface RuntimeMemoryGetFailure {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly outcome: "FAILED";
  readonly error: RuntimeProtocolError;
}

export type RuntimeMemoryGetResponse =
  RuntimeMemoryGetSuccess | RuntimeMemoryGetFailure;

export interface RuntimeMemorySetRequest {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly bindingName: string;
  readonly key: string;
  readonly value: JsonValue;
  readonly expectedRevision?: number;
}

export interface RuntimeMemorySetSuccess {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly outcome: "SUCCEEDED";
  readonly record: MemoryRecordView;
}

export interface RuntimeMemorySetFailure {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly outcome: "FAILED";
  readonly error: RuntimeProtocolError;
}

export type RuntimeMemorySetResponse =
  RuntimeMemorySetSuccess | RuntimeMemorySetFailure;

export interface RuntimeMemoryDeleteRequest {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly bindingName: string;
  readonly key: string;
  readonly expectedRevision?: number;
}

export interface RuntimeMemoryDeleteSuccess {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly outcome: "SUCCEEDED";
}

export interface RuntimeMemoryDeleteFailure {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly outcome: "FAILED";
  readonly error: RuntimeProtocolError;
}

export type RuntimeMemoryDeleteResponse =
  RuntimeMemoryDeleteSuccess | RuntimeMemoryDeleteFailure;

export interface RuntimeMemoryListRequest {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly bindingName: string;
  readonly prefix?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface RuntimeMemoryListSuccess {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly outcome: "SUCCEEDED";
  readonly items: readonly MemoryRecordView[];
  readonly nextCursor?: string;
}

export interface RuntimeMemoryListFailure {
  readonly protocolVersion: RuntimeProtocolVersion;
  readonly executionId: string;
  readonly outcome: "FAILED";
  readonly error: RuntimeProtocolError;
}

export type RuntimeMemoryListResponse =
  RuntimeMemoryListSuccess | RuntimeMemoryListFailure;
