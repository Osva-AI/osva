import type { AgentVersionId } from "./ids.js";

export const WORKFLOW_DEFINITION_SCHEMA_VERSION = "1" as const;

export type WorkflowDefinitionSchemaVersion =
  typeof WORKFLOW_DEFINITION_SCHEMA_VERSION;

/**
 * Conceptual node types for the pre-1.0 Workflow Definition.
 * Slice 2.1 stores graph-shaped definitions but only executes AGENT nodes.
 */
export const WORKFLOW_NODE_TYPES = [
  "AGENT",
  "TOOL",
  "RULE",
  "BRANCH",
  "PARALLEL",
  "WAIT",
  "APPROVAL",
  "HUMAN_TASK",
  "SUBWORKFLOW",
] as const;

export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export const WORKFLOW_EXECUTABLE_NODE_TYPES = ["AGENT"] as const;

export type WorkflowExecutableNodeType =
  (typeof WORKFLOW_EXECUTABLE_NODE_TYPES)[number];

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
