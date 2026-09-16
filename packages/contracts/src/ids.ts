declare const osvaIdBrand: unique symbol;

export type OsvaId<Name extends string> = string & {
  readonly [osvaIdBrand]: Name;
};

export type WorkspaceId = OsvaId<"WorkspaceId">;
export type AgentId = OsvaId<"AgentId">;
export type AgentVersionId = OsvaId<"AgentVersionId">;
export type DeploymentId = OsvaId<"DeploymentId">;
export type RunId = OsvaId<"RunId">;
export type RunAttemptId = OsvaId<"RunAttemptId">;
export type RunStepId = OsvaId<"RunStepId">;
export type ScheduleId = OsvaId<"ScheduleId">;
export type ScheduleOccurrenceId = OsvaId<"ScheduleOccurrenceId">;
export type WorkflowId = OsvaId<"WorkflowId">;
export type WorkflowVersionId = OsvaId<"WorkflowVersionId">;
export type WorkflowRunId = OsvaId<"WorkflowRunId">;
export type WorkflowNodeRunId = OsvaId<"WorkflowNodeRunId">;
export type ToolId = OsvaId<"ToolId">;
export type ToolVersionId = OsvaId<"ToolVersionId">;
export type ModelProfileId = OsvaId<"ModelProfileId">;
export type ModelProfileVersionId = OsvaId<"ModelProfileVersionId">;
export type EvaluationId = OsvaId<"EvaluationId">;
export type ArtifactId = OsvaId<"ArtifactId">;
export type EventId = OsvaId<"EventId">;
