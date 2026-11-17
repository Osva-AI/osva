import type {
  AgentVersionId,
  EvaluationCaseId,
  EvaluationRunId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva-ai/contracts";

import { EffectiveRunBindings } from "./effective-run-bindings.js";
import { DomainInvariantError } from "./errors.js";
import type { EvaluationRunApplicationDependencies } from "./evaluation-run-application.js";
import { knowledgeIndexBindingsFromManifest } from "./knowledge-index-bindings.js";
import { memoryNamespaceBindingsFromManifest } from "./memory-bindings.js";
import { modelProfileVersionBindingsFromManifest } from "./model-bindings.js";
import type { AgentRepository } from "./ports/agent-repository.js";
import type { EvaluationCase } from "./evaluation-case.js";
import type { EvaluationRun } from "./evaluation-run.js";
import type { EvaluationSuiteVersion } from "./evaluation-suite-version.js";
import { toolVersionBindingsFromManifest } from "./tool-bindings.js";
import { Run } from "./run.js";
import { RunAttempt } from "./run-attempt.js";

export function evaluationCaseIdempotencyKey(
  evaluationRunId: EvaluationRunId,
  evaluationCaseId: EvaluationCaseId,
): string {
  return `evaluation-run:${evaluationRunId}:case:${evaluationCaseId}`;
}

export async function materializeEvaluationChildRun(
  deps: EvaluationRunApplicationDependencies,
  options: {
    readonly workspaceId: WorkspaceId;
    readonly agentVersion: NonNullable<
      Awaited<ReturnType<AgentRepository["findAgentVersionById"]>>
    >;
    readonly evaluationRunId: EvaluationRunId;
    readonly evaluationCase: EvaluationCase;
    readonly now: Date;
  },
): Promise<RunId> {
  const idempotencyKey = evaluationCaseIdempotencyKey(
    options.evaluationRunId,
    options.evaluationCase.id,
  );

  const existing = await deps.runs.findRunByWorkspaceIdempotencyKey(
    options.workspaceId,
    idempotencyKey,
  );
  if (existing !== null) {
    assertChildRunIdentity(existing, options);
    await ensureChildRunDispatched(deps, existing, options.now);
    return existing.id;
  }

  const runId = deps.ids.createId() as RunId;
  const runAttemptId = deps.ids.createId() as RunAttemptId;
  const pending = Run.create({
    id: runId,
    workspaceId: options.workspaceId,
    agentId: options.agentVersion.agentId,
    effectiveBindings: EffectiveRunBindings.create({
      agentVersionId: options.agentVersion.id,
      modelProfileVersionBindings: modelProfileVersionBindingsFromManifest(
        options.agentVersion.manifest,
      ),
      toolVersionBindings: toolVersionBindingsFromManifest(
        options.agentVersion.manifest,
      ),
      memoryNamespaceBindings: memoryNamespaceBindingsFromManifest(
        options.agentVersion.manifest,
      ),
      knowledgeIndexBindings: knowledgeIndexBindingsFromManifest(
        options.agentVersion.manifest,
      ),
    }),
    input: options.evaluationCase.input,
    createdAt: options.now,
    idempotencyKey,
    evaluationRunId: options.evaluationRunId,
    evaluationCaseId: options.evaluationCase.id,
  });
  const attempt = RunAttempt.createFirst({
    id: runAttemptId,
    runId: pending.id,
    createdAt: options.now,
  });

  try {
    await deps.runs.createRunWithInitialAttempt(pending, attempt);
  } catch (error) {
    const raced = await deps.runs.findRunByWorkspaceIdempotencyKey(
      options.workspaceId,
      idempotencyKey,
    );
    if (raced === null) {
      throw error;
    }
    assertChildRunIdentity(raced, options);
    await ensureChildRunDispatched(deps, raced, options.now);
    return raced.id;
  }

  const queued = pending.transitionTo("QUEUED", options.now);
  await deps.runs.transitionRun("PENDING", queued);
  await deps.queue.enqueue(attempt.id);
  return pending.id;
}

async function ensureChildRunDispatched(
  deps: EvaluationRunApplicationDependencies,
  run: Run,
  now: Date,
): Promise<void> {
  const attempts = await deps.runs.listRunAttempts(run.id);
  const initial = attempts.find((attempt) => attempt.sequence === 1);
  if (initial === undefined) {
    throw new DomainInvariantError(
      `Evaluation child Run '${run.id}' is missing its initial RunAttempt.`,
    );
  }

  let current = run;
  if (current.status === "PENDING") {
    const queued = current.transitionTo("QUEUED", now);
    current = await deps.runs.transitionRun("PENDING", queued);
  }

  if (current.status === "QUEUED") {
    await deps.queue.enqueue(initial.id);
  }
}

function assertChildRunIdentity(
  run: Run,
  options: {
    readonly workspaceId: WorkspaceId;
    readonly evaluationRunId: EvaluationRunId;
    readonly evaluationCase: EvaluationCase;
  },
): void {
  if (run.workspaceId !== options.workspaceId) {
    throw new DomainInvariantError(
      "Evaluation child Run idempotency key is bound to a different workspace.",
    );
  }
  if (
    run.evaluationRunId !== options.evaluationRunId ||
    run.evaluationCaseId !== options.evaluationCase.id
  ) {
    throw new DomainInvariantError(
      "Evaluation child Run idempotency key is bound to a different evaluation case.",
    );
  }
}

export async function ensureEvaluationLaunchMaterialized(
  deps: EvaluationRunApplicationDependencies,
  evaluationRun: EvaluationRun,
  suiteVersion: EvaluationSuiteVersion,
  agentVersionId: AgentVersionId,
  now: Date,
): Promise<void> {
  const agentVersion = await deps.agents.findAgentVersionById(agentVersionId);
  if (agentVersion === null) {
    throw new DomainInvariantError(
      `AgentVersion '${agentVersionId}' was not found during evaluation launch recovery.`,
    );
  }

  const cases = [...suiteVersion.cases].sort((left, right) =>
    left.key.localeCompare(right.key),
  );

  for (const evaluationCase of cases) {
    await materializeEvaluationChildRun(deps, {
      workspaceId: evaluationRun.workspaceId,
      agentVersion,
      evaluationRunId: evaluationRun.id,
      evaluationCase,
      now,
    });
  }

  const childRuns = await deps.runs.listRunsByEvaluationRunId(
    evaluationRun.workspaceId,
    evaluationRun.id,
  );
  const childCaseIds = new Set(
    childRuns
      .map((run) => run.evaluationCaseId)
      .filter((caseId): caseId is EvaluationCaseId => caseId !== undefined),
  );

  if (childCaseIds.size < cases.length) {
    return;
  }

  if (evaluationRun.status === "PENDING") {
    const running = evaluationRun.transitionTo("RUNNING", {
      updatedAt: now,
      startedAt: now,
    });
    await deps.evaluationSuites.transitionEvaluationRun("PENDING", running);
  }
}
