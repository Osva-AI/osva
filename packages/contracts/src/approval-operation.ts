import type { JsonValue } from "./json-value.js";
import type {
  ToolVersionId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "./ids.js";

export const APPROVAL_OPERATION_BINDING_SCHEMA_VERSION = 1 as const;

export const APPROVAL_OPERATION_KINDS = {
  WORKFLOW_NODE_PROGRESSION: "WORKFLOW_NODE_PROGRESSION",
  TOOL_INVOCATION: "TOOL_INVOCATION",
} as const;

export type ApprovalOperationKind =
  (typeof APPROVAL_OPERATION_KINDS)[keyof typeof APPROVAL_OPERATION_KINDS];

/** Canonical sha256 digest prefix for approval operation bindings. */
export const APPROVAL_OPERATION_DIGEST_PREFIX = "sha256:" as const;

export interface WorkflowNodeProgressionApprovalOperation {
  readonly schemaVersion: typeof APPROVAL_OPERATION_BINDING_SCHEMA_VERSION;
  readonly kind: typeof APPROVAL_OPERATION_KINDS.WORKFLOW_NODE_PROGRESSION;
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly workflowNodeRunId: WorkflowNodeRunId;
  /** Digest of the APPROVAL node's frozen input payload (`sha256:<hex>`). */
  readonly inputDigest: string;
}

export interface ToolInvocationApprovalOperation {
  readonly schemaVersion: typeof APPROVAL_OPERATION_BINDING_SCHEMA_VERSION;
  readonly kind: typeof APPROVAL_OPERATION_KINDS.TOOL_INVOCATION;
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly runId: string;
  readonly runAttemptId: string;
  readonly bindingName: string;
  readonly toolVersionId: ToolVersionId;
  /** Digest of canonical tool arguments (`sha256:<hex>`). Secrets must not appear in args. */
  readonly argumentsDigest: string;
}

export type ApprovalOperationBinding =
  WorkflowNodeProgressionApprovalOperation | ToolInvocationApprovalOperation;

export interface WorkflowNodeApprovalBindingContext {
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly workflowNodeRunId: WorkflowNodeRunId;
  readonly nodeInput: JsonValue;
}

export interface ToolInvocationApprovalBindingContext {
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly runId: string;
  readonly runAttemptId: string;
  readonly bindingName: string;
  readonly toolVersionId: ToolVersionId;
  readonly arguments: JsonValue;
}

export const APPROVAL_OPERATION_MISMATCH_ERROR_CODE =
  "APPROVAL_OPERATION_MISMATCH";
export const APPROVAL_EXPIRED_ERROR_CODE = "APPROVAL_EXPIRED";
