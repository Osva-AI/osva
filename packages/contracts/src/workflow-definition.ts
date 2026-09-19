import type { AgentVersionId } from "./ids.js";

export const WORKFLOW_DEFINITION_SCHEMA_VERSION = "1" as const;
export const WORKFLOW_DEFINITION_SCHEMA_VERSION_V2 = "2" as const;
export const WORKFLOW_DEFINITION_SCHEMA_VERSION_V3 = "3" as const;

export const WORKFLOW_DEFINITION_SCHEMA_VERSIONS = [
  WORKFLOW_DEFINITION_SCHEMA_VERSION,
  WORKFLOW_DEFINITION_SCHEMA_VERSION_V2,
  WORKFLOW_DEFINITION_SCHEMA_VERSION_V3,
] as const;

export const WORKFLOW_EXECUTABLE_DEFINITION_SCHEMA_VERSIONS = [
  WORKFLOW_DEFINITION_SCHEMA_VERSION,
  WORKFLOW_DEFINITION_SCHEMA_VERSION_V2,
  WORKFLOW_DEFINITION_SCHEMA_VERSION_V3,
] as const;

export type WorkflowDefinitionSchemaVersion =
  typeof WORKFLOW_DEFINITION_SCHEMA_VERSION;

export type WorkflowDefinitionSchemaVersionV2 =
  typeof WORKFLOW_DEFINITION_SCHEMA_VERSION_V2;

export type WorkflowDefinitionSchemaVersionV3 =
  typeof WORKFLOW_DEFINITION_SCHEMA_VERSION_V3;

export type WorkflowDefinitionSchemaVersionAny =
  | WorkflowDefinitionSchemaVersion
  | WorkflowDefinitionSchemaVersionV2
  | WorkflowDefinitionSchemaVersionV3;

/**
 * Conceptual node types for the pre-1.0 Workflow Definition.
 * Slice 2.1 executes AGENT-only linear graphs (schemaVersion 1).
 * Slice 2.2 executes AGENT + BRANCH + PARALLEL + JOIN DAGs (schemaVersion 2).
 * Slice 2.3 adds APPROVAL as an OSVA orchestration node (schemaVersion 2).
 */
export const WORKFLOW_NODE_TYPES = [
  "AGENT",
  "TOOL",
  "RULE",
  "BRANCH",
  "PARALLEL",
  "JOIN",
  "WAIT",
  "APPROVAL",
  "HUMAN_TASK",
  "SUBWORKFLOW",
] as const;

export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export const WORKFLOW_EXECUTABLE_NODE_TYPES = ["AGENT"] as const;

export type WorkflowExecutableNodeType =
  (typeof WORKFLOW_EXECUTABLE_NODE_TYPES)[number];

export const WORKFLOW_V2_NODE_TYPES = [
  "AGENT",
  "BRANCH",
  "PARALLEL",
  "JOIN",
  "APPROVAL",
] as const;

export type WorkflowV2NodeType = (typeof WORKFLOW_V2_NODE_TYPES)[number];

export const WORKFLOW_V2_ORCHESTRATION_NODE_TYPES = [
  "BRANCH",
  "PARALLEL",
  "JOIN",
  "APPROVAL",
] as const;

export type WorkflowV2OrchestrationNodeType =
  (typeof WORKFLOW_V2_ORCHESTRATION_NODE_TYPES)[number];

export const WORKFLOW_V3_NODE_TYPES = [
  "AGENT",
  "BRANCH",
  "PARALLEL",
  "JOIN",
  "APPROVAL",
  "WAIT",
] as const;

export type WorkflowV3NodeType = (typeof WORKFLOW_V3_NODE_TYPES)[number];

export const WORKFLOW_V3_ORCHESTRATION_NODE_TYPES = [
  "BRANCH",
  "PARALLEL",
  "JOIN",
  "APPROVAL",
  "WAIT",
] as const;

export type WorkflowV3OrchestrationNodeType =
  (typeof WORKFLOW_V3_ORCHESTRATION_NODE_TYPES)[number];

export type WorkflowBranchEqualsValue = string | number | boolean | null;

export interface WorkflowDefinitionNodeV1 {
  readonly key: string;
  readonly type: WorkflowExecutableNodeType;
  readonly agentVersionId: AgentVersionId;
}

export interface WorkflowDefinitionEdgeV1 {
  readonly from: string;
  readonly to: string;
}

/**
 * Stage 2.1 stored WorkflowVersion definition.
 *
 * The graph is persisted as nodes plus edges so later slices can relax
 * sequential-only validation without redesigning persistence. Slice 2.1
 * still requires a single linear AGENT chain and immutable AgentVersion
 * bindings.
 */
export interface WorkflowDefinitionV1 {
  readonly schemaVersion: WorkflowDefinitionSchemaVersion;
  readonly nodes: readonly WorkflowDefinitionNodeV1[];
  readonly edges: readonly WorkflowDefinitionEdgeV1[];
}

export interface WorkflowDefinitionAgentNodeV2 {
  readonly key: string;
  readonly type: "AGENT";
  readonly agentVersionId: AgentVersionId;
}

export interface WorkflowDefinitionBranchCaseV2 {
  readonly equals: WorkflowBranchEqualsValue;
  readonly to: string;
}

export interface WorkflowDefinitionBranchNodeV2 {
  readonly key: string;
  readonly type: "BRANCH";
  readonly selector: string;
  readonly cases: readonly WorkflowDefinitionBranchCaseV2[];
  readonly defaultTo: string;
}

export interface WorkflowDefinitionParallelNodeV2 {
  readonly key: string;
  readonly type: "PARALLEL";
}

export interface WorkflowDefinitionJoinNodeV2 {
  readonly key: string;
  readonly type: "JOIN";
}

export const WORKFLOW_APPROVAL_TITLE_MAX_LENGTH = 200;
export const WORKFLOW_APPROVAL_DESCRIPTION_MAX_LENGTH = 2000;

export interface WorkflowDefinitionApprovalNodeV2 {
  readonly key: string;
  readonly type: "APPROVAL";
  readonly title: string;
  readonly description?: string;
}

export type WorkflowDefinitionNodeV2 =
  | WorkflowDefinitionAgentNodeV2
  | WorkflowDefinitionBranchNodeV2
  | WorkflowDefinitionParallelNodeV2
  | WorkflowDefinitionJoinNodeV2
  | WorkflowDefinitionApprovalNodeV2;

export type WorkflowDefinitionEdgeV2 = WorkflowDefinitionEdgeV1;

/**
 * Stage 2.2 DAG WorkflowVersion definition.
 *
 * V1 sequential graphs remain valid and executable. V2 adds BRANCH, PARALLEL,
 * JOIN, and APPROVAL orchestration nodes. AGENT remains the only node that
 * creates a canonical Run. Cross-agent execution is created only by workflow
 * orchestration.
 */
export interface WorkflowDefinitionV2 {
  readonly schemaVersion: WorkflowDefinitionSchemaVersionV2;
  readonly nodes: readonly WorkflowDefinitionNodeV2[];
  readonly edges: readonly WorkflowDefinitionEdgeV2[];
}

export interface WorkflowDefinitionWaitDurationV3 {
  readonly kind: "DURATION";
  readonly durationMs: number;
}

export interface WorkflowDefinitionWaitUntilV3 {
  readonly kind: "UNTIL";
  readonly until: string;
}

export interface WorkflowDefinitionWaitCorrelationLiteralV3 {
  readonly kind: "LITERAL";
  readonly value: string;
}

export interface WorkflowDefinitionWaitCorrelationInputPointerV3 {
  readonly kind: "INPUT_POINTER";
  readonly pointer: string;
}

export type WorkflowDefinitionWaitCorrelationV3 =
  | WorkflowDefinitionWaitCorrelationLiteralV3
  | WorkflowDefinitionWaitCorrelationInputPointerV3;

export interface WorkflowDefinitionWaitEventV3 {
  readonly kind: "EVENT";
  readonly source: string;
  readonly eventType: string;
  readonly correlation: WorkflowDefinitionWaitCorrelationV3;
  readonly timeoutMs?: number;
}

export type WorkflowDefinitionWaitConfigurationV3 =
  | WorkflowDefinitionWaitDurationV3
  | WorkflowDefinitionWaitUntilV3
  | WorkflowDefinitionWaitEventV3;

export interface WorkflowDefinitionWaitNodeV3 {
  readonly key: string;
  readonly type: "WAIT";
  readonly wait: WorkflowDefinitionWaitConfigurationV3;
}

export type WorkflowDefinitionNodeV3 =
  | WorkflowDefinitionAgentNodeV2
  | WorkflowDefinitionBranchNodeV2
  | WorkflowDefinitionParallelNodeV2
  | WorkflowDefinitionJoinNodeV2
  | WorkflowDefinitionApprovalNodeV2
  | WorkflowDefinitionWaitNodeV3;

export type WorkflowDefinitionEdgeV3 = WorkflowDefinitionEdgeV1;

/**
 * Stage 3.2 stable OSS Workflow Definition (persisted schemaVersion 3).
 *
 * V3 adds WAIT orchestration nodes. Execution is supported once the durable wait
 * backend is enabled (Stage 3.3).
 */
export interface WorkflowDefinitionV3 {
  readonly schemaVersion: WorkflowDefinitionSchemaVersionV3;
  readonly nodes: readonly WorkflowDefinitionNodeV3[];
  readonly edges: readonly WorkflowDefinitionEdgeV3[];
}

export type WorkflowDefinition =
  WorkflowDefinitionV1 | WorkflowDefinitionV2 | WorkflowDefinitionV3;

/** Workflow definitions that the current orchestrator may execute. */
export type ExecutableWorkflowDefinition =
  WorkflowDefinitionV1 | WorkflowDefinitionV2 | WorkflowDefinitionV3;

export function isWorkflowDefinitionV1(
  definition: WorkflowDefinition,
): definition is WorkflowDefinitionV1 {
  return definition.schemaVersion === WORKFLOW_DEFINITION_SCHEMA_VERSION;
}

export function isWorkflowDefinitionV2(
  definition: WorkflowDefinition,
): definition is WorkflowDefinitionV2 {
  return definition.schemaVersion === WORKFLOW_DEFINITION_SCHEMA_VERSION_V2;
}

export function isWorkflowDefinitionV3(
  definition: WorkflowDefinition,
): definition is WorkflowDefinitionV3 {
  return definition.schemaVersion === WORKFLOW_DEFINITION_SCHEMA_VERSION_V3;
}

export function isExecutableWorkflowDefinition(
  definition: WorkflowDefinition,
): definition is ExecutableWorkflowDefinition {
  return (
    isWorkflowDefinitionV1(definition) ||
    isWorkflowDefinitionV2(definition) ||
    isWorkflowDefinitionV3(definition)
  );
}

export function isWorkflowAgentNode(
  node:
    | WorkflowDefinitionNodeV1
    | WorkflowDefinitionNodeV2
    | WorkflowDefinitionNodeV3,
): node is WorkflowDefinitionNodeV1 | WorkflowDefinitionAgentNodeV2 {
  return node.type === "AGENT";
}

export function isWorkflowApprovalNode(
  node:
    | WorkflowDefinitionNodeV1
    | WorkflowDefinitionNodeV2
    | WorkflowDefinitionNodeV3,
): node is WorkflowDefinitionApprovalNodeV2 {
  return node.type === "APPROVAL";
}

export function isWorkflowWaitNode(
  node: WorkflowDefinitionNodeV3,
): node is WorkflowDefinitionWaitNodeV3 {
  return node.type === "WAIT";
}
