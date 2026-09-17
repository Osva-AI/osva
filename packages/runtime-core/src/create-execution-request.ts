import type { ExecutionRequest } from "@osva/contracts";
import type { AgentVersion, Run, RunAttempt } from "@osva/domain";
import { DomainInvariantError } from "@osva/domain";

export interface ExecutionRequestSource {
  readonly run: Run;
  readonly runAttempt: RunAttempt;
  readonly agentVersion: AgentVersion;
}

/**
 * Builds an ExecutionRequest from persisted OSVA identities and snapshots.
 * Stage 0 leaves unimplemented capabilities as empty contract-shaped values.
 */
export function createExecutionRequest(
  source: ExecutionRequestSource,
): ExecutionRequest {
  if (source.runAttempt.runId !== source.run.id) {
    throw new DomainInvariantError(
      "RunAttempt.runId must match the loaded Run.",
    );
  }

  if (source.agentVersion.id !== source.run.effectiveBindings.agentVersionId) {
    throw new DomainInvariantError(
      "Loaded AgentVersion does not match Run.effectiveBindings.agentVersionId.",
    );
  }

  if (source.agentVersion.agentId !== source.run.agentId) {
    throw new DomainInvariantError(
      "Loaded AgentVersion.agentId does not match Run.agentId.",
    );
  }

  return Object.freeze({
    runId: source.run.id,
    runAttemptId: source.runAttempt.id,
    workspaceId: source.run.workspaceId,
    agentId: source.run.agentId,
    agentVersionId: source.run.effectiveBindings.agentVersionId,
    runtime: source.agentVersion.manifest.runtime,
    input: source.run.input,
    effectiveConfig: Object.freeze({}),
    modelProfileVersionBindings:
      source.run.effectiveBindings.modelProfileVersionBindings,
    toolVersionBindings: source.run.effectiveBindings.toolVersionBindings,
    memoryNamespaceBindings:
      source.run.effectiveBindings.memoryNamespaceBindings,
    toolGrants: Object.freeze([]),
    timeoutMs: source.agentVersion.manifest.execution.timeoutMs,
    policyContext: Object.freeze({}),
    evaluationContext:
      source.run.evaluationRunId !== undefined &&
      source.run.evaluationCaseId !== undefined
        ? Object.freeze({
            evaluationRunId: source.run.evaluationRunId,
            evaluationCaseId: source.run.evaluationCaseId,
          })
        : undefined,
  });
}
