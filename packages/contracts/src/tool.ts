import type {
  RunId,
  RunStepId,
  ToolId,
  ToolVersionId,
  WorkflowNodeRunId,
  WorkflowRunId,
} from "./ids.js";
import type { JsonSchemaRecord } from "./json-schema.js";
import type { SecretReference } from "./secret-reference.js";

export interface ToolDefinition {
  readonly toolId: ToolId;
}

export interface ToolImplementationRef {
  readonly type: string;
  readonly key: string;
}

export interface ToolVersionDefinition {
  readonly toolId: ToolId;
  readonly toolVersionId: ToolVersionId;
  readonly inputSchema: JsonSchemaRecord;
  readonly outputSchema: JsonSchemaRecord;
  readonly riskClassification: string;
  readonly timeoutMs: number;
  readonly idempotencyBehavior: string;
  readonly implementationRef: ToolImplementationRef;
  readonly credentialRequirements: readonly SecretReference[];
}

/**
 * Authorization to use a logical Tool.
 * Version pinning is not part of the Stage 0 grant.
 */
export interface ToolGrant {
  readonly toolId: ToolId;
}

/**
 * One Tool operation bound to an immutable ToolVersion.
 * `operationId` identifies the logical operation. `runAttemptId` is not part of
 * this contract and must not be used as operation or idempotency identity.
 */
export interface ToolInvocation {
  readonly toolVersionId: ToolVersionId;
  readonly input: unknown;
  readonly operationId: string;
  readonly idempotencyKey?: string;
  readonly runId?: RunId;
  readonly runStepId?: RunStepId;
  readonly workflowRunId?: WorkflowRunId;
  readonly workflowNodeRunId?: WorkflowNodeRunId;
}

export interface ToolError {
  readonly code: string;
  readonly message: string;
}

export interface ToolSuccess {
  readonly status: "succeeded";
  readonly output: unknown;
}

export interface ToolFailure {
  readonly status: "failed";
  readonly error: ToolError;
}

export type ToolResult = ToolSuccess | ToolFailure;

export interface ToolExecutor {
  execute(invocation: ToolInvocation): Promise<ToolResult>;
}
