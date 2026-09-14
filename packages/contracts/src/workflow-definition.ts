export const WORKFLOW_DEFINITION_SCHEMA_VERSION = "1" as const;

export type WorkflowDefinitionSchemaVersion =
  typeof WORKFLOW_DEFINITION_SCHEMA_VERSION;

export const WORKFLOW_NODE_TYPES = [
  "agent",
  "tool",
  "rule",
  "branch",
  "parallel",
  "wait",
  "approval",
  "human_task",
  "subworkflow",
] as const;

export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export interface WorkflowNodeV1 {
  readonly id: string;
  readonly type: WorkflowNodeType;
  readonly agentRef?: string;
  readonly dependsOn?: readonly string[];
}

export interface WorkflowDefinitionV1 {
  readonly schemaVersion: WorkflowDefinitionSchemaVersion;
  readonly key: string;
  readonly name: string;
  readonly nodes: readonly WorkflowNodeV1[];
}
