import type { AgentVersionId } from "./ids.js";

export const WORKFLOW_DEFINITION_SCHEMA_VERSION = "1" as const;
export const WORKFLOW_DEFINITION_SCHEMA_VERSION_V2 = "2" as const;

export const WORKFLOW_DEFINITION_SCHEMA_VERSIONS = [
  WORKFLOW_DEFINITION_SCHEMA_VERSION,
  WORKFLOW_DEFINITION_SCHEMA_VERSION_V2,
] as const;

export type WorkflowDefinitionSchemaVersion =
  typeof WORKFLOW_DEFINITION_SCHEMA_VERSION;

export type WorkflowDefinitionSchemaVersionV2 =
  typeof WORKFLOW_DEFINITION_SCHEMA_VERSION_V2;

/**
 * Conceptual node types for the pre-1.0 Workflow Definition.
 * Slice 2.1 executes AGENT-only linear graphs (schemaVersion 1).
 * Slice 2.2 executes AGENT + BRANCH + PARALLEL + JOIN DAGs (schemaVersion 2).
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
] as const;

export type WorkflowV2NodeType = (typeof WORKFLOW_V2_NODE_TYPES)[number];

export const WORKFLOW_V2_ORCHESTRATION_NODE_TYPES = [
  "BRANCH",
  "PARALLEL",
  "JOIN",
] as const;

export type WorkflowV2OrchestrationNodeType =
  (typeof WORKFLOW_V2_ORCHESTRATION_NODE_TYPES)[number];

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

export type WorkflowDefinitionNodeV2 =
  | WorkflowDefinitionAgentNodeV2
  | WorkflowDefinitionBranchNodeV2
  | WorkflowDefinitionParallelNodeV2
  | WorkflowDefinitionJoinNodeV2;

export type WorkflowDefinitionEdgeV2 = WorkflowDefinitionEdgeV1;

/**
 * Stage 2.2 DAG WorkflowVersion definition.
 *
 * V1 sequential graphs remain valid and executable. V2 adds BRANCH, PARALLEL,
 * and JOIN orchestration nodes. AGENT remains the only node that creates a
 * canonical Run.
 */
export interface WorkflowDefinitionV2 {
  readonly schemaVersion: WorkflowDefinitionSchemaVersionV2;
  readonly nodes: readonly WorkflowDefinitionNodeV2[];
  readonly edges: readonly WorkflowDefinitionEdgeV2[];
}

export type WorkflowDefinition = WorkflowDefinitionV1 | WorkflowDefinitionV2;

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

export function isWorkflowAgentNode(
  node: WorkflowDefinitionNodeV1 | WorkflowDefinitionNodeV2,
): node is WorkflowDefinitionNodeV1 | WorkflowDefinitionAgentNodeV2 {
  return node.type === "AGENT";
}
