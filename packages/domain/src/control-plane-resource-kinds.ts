/** Stable control-plane resource kinds for authorization (Pass 2). */
export const CONTROL_PLANE_RESOURCE_KINDS = {
  agent: "agent",
  tool: "tool",
  connector: "connector",
  modelProfile: "model_profile",
  workflow: "workflow",
  workflowRun: "workflow_run",
  approvalRequest: "approval_request",
  run: "run",
  schedule: "schedule",
  artifact: "artifact",
  memory: "memory",
  knowledge: "knowledge",
  evaluationSuite: "evaluation_suite",
  evaluationRun: "evaluation_run",
  evaluation: "evaluation",
  office: "office",
  workflowEvent: "workflow_event",
  apiKey: "api_key",
} as const;

export type ControlPlaneResourceKind =
  (typeof CONTROL_PLANE_RESOURCE_KINDS)[keyof typeof CONTROL_PLANE_RESOURCE_KINDS];
