import type {
  AgentId,
  AgentVersionId,
  RunAttemptId,
  RunId,
  RunStepId,
  WorkflowRunId,
  WorkspaceId,
} from "./ids.js";

export interface TelemetryCorrelation {
  readonly workspaceId?: WorkspaceId;
  readonly agentId?: AgentId;
  readonly agentVersionId?: AgentVersionId;
  readonly workflowRunId?: WorkflowRunId;
  readonly runId?: RunId;
  readonly runAttemptId?: RunAttemptId;
  readonly runStepId?: RunStepId;
}

/**
 * Normalized telemetry for external exporters.
 * Exporters are not canonical storage; dropping them must not destroy Run state.
 */
export interface TelemetryEvent {
  readonly name: string;
  readonly occurredAt: string;
  readonly correlation: TelemetryCorrelation;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export interface TelemetrySink {
  emit(event: TelemetryEvent): Promise<void>;
}
