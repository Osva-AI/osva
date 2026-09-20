import type { JobQueue } from "@osva/contracts";
import type {
  AgentVersionId,
  EvaluationCaseId,
  EvaluationCaseOutcome,
  EvaluationRunId,
  EvaluationRunTargetType,
  EvaluationSuiteVersionId,
  JsonValue,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva/contracts";
import { isCanonicalJsonValue } from "@osva/contracts";

import { EffectiveRunBindings } from "./effective-run-bindings.js";
import { EvaluationCaseResult } from "./evaluation-case-result.js";
import { EvaluationRun } from "./evaluation-run.js";
import {
  AgentNotFoundError,
  AgentVersionNotFoundError,
  DomainInvariantError,
  EvaluationCaseNotFoundError,
  EvaluationRunNotFoundError,
  EvaluationSuiteVersionNotFoundError,
  RunAttemptNotFoundError,
  RunNotFoundError,
} from "./errors.js";
import { jsonValuesEqual } from "./json-equality.js";
import { knowledgeIndexBindingsFromManifest } from "./knowledge-index-bindings.js";
import { memoryNamespaceBindingsFromManifest } from "./memory-bindings.js";
import { modelProfileVersionBindingsFromManifest } from "./model-bindings.js";
import { toolVersionBindingsFromManifest } from "./tool-bindings.js";
import type { AgentRepository } from "./ports/agent-repository.js";
import type { EvaluationSuiteRepository } from "./ports/evaluation-suite-repository.js";
import type { RunRepository } from "./ports/run-repository.js";
import { Run } from "./run.js";
import { RunAttempt } from "./run-attempt.js";
import { isTerminalRunAttemptState } from "./run-attempt-state-machine.js";

export interface EvaluationRunApplicationClock {
  now(): Date;
}

export interface EvaluationRunApplicationIds {
  createId(): string;
}

export interface EvaluationRunApplicationDependencies {
  readonly evaluationSuites: EvaluationSuiteRepository;
  readonly runs: RunRepository;
  readonly agents: AgentRepository;
  readonly queue: JobQueue;
  readonly clock: EvaluationRunApplicationClock;
  readonly ids: EvaluationRunApplicationIds;
}

export interface LaunchEvaluationRunCommand {
  readonly workspaceId: WorkspaceId;
  readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;
  readonly targetType: EvaluationRunTargetType;
  readonly targetVersionId: string;
}

export interface ReconcileEvaluationCaseCommand {
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
}

export class LaunchEvaluationRun {
  constructor(private readonly deps: EvaluationRunApplicationDependencies) {}

  async execute(command: LaunchEvaluationRunCommand): Promise<EvaluationRun> {
    const suiteVersion = await this.deps.evaluationSuites.findSuiteVersionById(
      command.evaluationSuiteVersionId,
    );
    if (
      suiteVersion === null ||
      suiteVersion.workspaceId !== command.workspaceId
    ) {
      throw new EvaluationSuiteVersionNotFoundError(
        command.evaluationSuiteVersionId,
      );
    }

    if (command.targetType !== "AGENT_VERSION") {
      throw new Error("Only AGENT_VERSION evaluation targets are supported.");
    }

    const agentVersion = await this.loadAgentVersion(
      command.workspaceId,
      command.targetVersionId as AgentVersionId,
    );

    const now = this.deps.clock.now();
    const evaluationRun = EvaluationRun.create({
      id: this.deps.ids.createId() as EvaluationRunId,
      workspaceId: command.workspaceId,
      evaluationSuiteVersionId: command.evaluationSuiteVersionId,
      targetType: command.targetType,
      targetVersionId: command.targetVersionId,
      createdAt: now,
    });

    await this.deps.evaluationSuites.saveEvaluationRun(evaluationRun);

    const cases = [...suiteVersion.cases].sort((left, right) =>
      left.key.localeCompare(right.key),
    );

    for (const evaluationCase of cases) {
      await this.createEvaluationChildRun({
        workspaceId: command.workspaceId,
        agentVersion,
        evaluationRunId: evaluationRun.id,
        evaluationCaseId: evaluationCase.id,
        input: evaluationCase.input,
        now,
      });
    }

    const running = evaluationRun.transitionTo("RUNNING", {
      updatedAt: now,
      startedAt: now,
    });
    await this.deps.evaluationSuites.transitionEvaluationRun(
      evaluationRun.status,
      running,
    );

    return running;
  }

  private async loadAgentVersion(
    workspaceId: WorkspaceId,
    agentVersionId: AgentVersionId,
  ) {
    const agentVersion =
      await this.deps.agents.findAgentVersionById(agentVersionId);
    if (agentVersion === null) {
      throw new AgentVersionNotFoundError(agentVersionId);
    }

    const agent = await this.deps.agents.findAgentById(agentVersion.agentId);
    if (agent === null) {
      throw new AgentNotFoundError(agentVersion.agentId);
    }

    if (agent.workspaceId !== workspaceId) {
      throw new DomainInvariantError(
        `Agent ${agent.id} belongs to workspace ${agent.workspaceId}, not ${workspaceId}.`,
      );
    }

    return agentVersion;
  }

  private async createEvaluationChildRun(options: {
    readonly workspaceId: WorkspaceId;
    readonly agentVersion: Awaited<
      ReturnType<AgentRepository["findAgentVersionById"]>
    > & {};
    readonly evaluationRunId: EvaluationRunId;
    readonly evaluationCaseId: EvaluationCaseId;
    readonly input: JsonValue;
    readonly now: Date;
  }): Promise<void> {
    const runId = this.deps.ids.createId() as RunId;
    const runAttemptId = this.deps.ids.createId() as RunAttemptId;
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
      input: options.input,
      createdAt: options.now,
      idempotencyKey: evaluationCaseIdempotencyKey(
        options.evaluationRunId,
        options.evaluationCaseId,
      ),
      evaluationRunId: options.evaluationRunId,
      evaluationCaseId: options.evaluationCaseId,
    });
    const attempt = RunAttempt.createFirst({
      id: runAttemptId,
      runId: pending.id,
      createdAt: options.now,
    });

    await this.deps.runs.createRunWithInitialAttempt(pending, attempt);

    const queued = pending.transitionTo("QUEUED", options.now);
    await this.deps.runs.transitionRun("PENDING", queued);
    await this.deps.queue.enqueue(attempt.id);
  }
}

export class GetEvaluationRun {
  constructor(private readonly deps: EvaluationRunApplicationDependencies) {}

  async execute(evaluationRunId: EvaluationRunId): Promise<{
    readonly evaluationRun: EvaluationRun;
    readonly summary: EvaluationRunSummary;
  }> {
    const evaluationRun =
      await this.deps.evaluationSuites.findEvaluationRunById(evaluationRunId);
    if (evaluationRun === null) {
      throw new EvaluationRunNotFoundError(evaluationRunId);
    }

    const suiteVersion = await this.deps.evaluationSuites.findSuiteVersionById(
      evaluationRun.evaluationSuiteVersionId,
    );
    if (suiteVersion === null) {
      throw new EvaluationSuiteVersionNotFoundError(
        evaluationRun.evaluationSuiteVersionId,
      );
    }

    const caseResults =
      await this.deps.evaluationSuites.listCaseResultsByEvaluationRun(
        evaluationRunId,
      );

    return {
      evaluationRun,
      summary: buildEvaluationRunSummary(
        suiteVersion.cases.length,
        caseResults,
      ),
    };
  }
}

export class ListEvaluationCaseResults {
  constructor(private readonly deps: EvaluationRunApplicationDependencies) {}

  async execute(
    evaluationRunId: EvaluationRunId,
  ): Promise<readonly EvaluationCaseResult[]> {
    const evaluationRun =
      await this.deps.evaluationSuites.findEvaluationRunById(evaluationRunId);
    if (evaluationRun === null) {
      throw new EvaluationRunNotFoundError(evaluationRunId);
    }

    return this.deps.evaluationSuites.listCaseResultsByEvaluationRun(
      evaluationRunId,
    );
  }
}

export class ReconcileEvaluationCase {
  constructor(private readonly deps: EvaluationRunApplicationDependencies) {}

  async execute(command: ReconcileEvaluationCaseCommand): Promise<void> {
    const run = await this.deps.runs.findRunById(command.runId);
    if (run === null) {
      throw new RunNotFoundError(command.runId);
    }

    if (
      run.evaluationRunId === undefined ||
      run.evaluationCaseId === undefined
    ) {
      return;
    }

    const attempt = await this.deps.runs.findRunAttemptById(
      command.runAttemptId,
    );
    if (attempt === null || attempt.runId !== run.id) {
      throw new RunAttemptNotFoundError(command.runAttemptId);
    }

    if (!isTerminalRunAttemptState(attempt.status)) {
      return;
    }

    const existing =
      await this.deps.evaluationSuites.findCaseResultByRunAndCase(
        run.evaluationRunId,
        run.evaluationCaseId,
      );
    if (existing !== null) {
      await reconcileEvaluationRunStatus(
        this.deps,
        run.evaluationRunId,
        this.deps.clock.now(),
      );
      return;
    }

    const evaluationCase = await this.deps.evaluationSuites.findCaseById(
      run.evaluationCaseId,
    );
    if (evaluationCase === null) {
      throw new EvaluationCaseNotFoundError(run.evaluationCaseId);
    }

    const now = this.deps.clock.now();
    const { outcome, evaluatorResults } = evaluateTerminalAttempt(
      attempt.status,
      attempt.output,
      evaluationCase.expected,
      evaluationCase.evaluator,
    );

    const result = EvaluationCaseResult.create({
      id: this.deps.ids.createId() as EvaluationCaseResult["id"],
      evaluationRunId: run.evaluationRunId,
      evaluationCaseId: run.evaluationCaseId,
      runId: run.id,
      outcome,
      evaluatorResults,
      createdAt: now,
      completedAt: now,
    });

    await this.deps.evaluationSuites.saveCaseResult(result);
    await reconcileEvaluationRunStatus(this.deps, run.evaluationRunId, now);
  }
}

export interface EvaluationRunSummary {
  readonly totalCases: number;
  readonly pendingCases: number;
  readonly runningCases: number;
  readonly completedCases: number;
  readonly passedCases: number;
  readonly failedCases: number;
  readonly errorCases: number;
  readonly passRate: number;
  readonly durationMs?: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly pricedCostUsdMicros: number;
  readonly unpricedModelCalls: number;
}

export interface EvaluationRunApplication {
  readonly launchEvaluationRun: LaunchEvaluationRun;
  readonly getEvaluationRun: GetEvaluationRun;
  readonly listEvaluationCaseResults: ListEvaluationCaseResults;
  readonly reconcileEvaluationCase: ReconcileEvaluationCase;
}

export function createEvaluationRunApplication(
  deps: EvaluationRunApplicationDependencies,
): EvaluationRunApplication {
  return {
    launchEvaluationRun: new LaunchEvaluationRun(deps),
    getEvaluationRun: new GetEvaluationRun(deps),
    listEvaluationCaseResults: new ListEvaluationCaseResults(deps),
    reconcileEvaluationCase: new ReconcileEvaluationCase(deps),
  };
}

function evaluationCaseIdempotencyKey(
  evaluationRunId: EvaluationRunId,
  evaluationCaseId: EvaluationCaseId,
): string {
  return `evaluation-run:${evaluationRunId}:case:${evaluationCaseId}`;
}

function evaluateTerminalAttempt(
  attemptStatus: string,
  output: unknown,
  expected: JsonValue | undefined,
  evaluator: { readonly type: string; readonly expected?: JsonValue },
): {
  readonly outcome: EvaluationCaseOutcome;
  readonly evaluatorResults: Readonly<Record<string, unknown>>;
} {
  if (attemptStatus !== "SUCCEEDED") {
    return {
      outcome: "ERROR",
      evaluatorResults: {
        reason: "run_attempt_not_succeeded",
        attemptStatus,
      },
    };
  }

  if (!isCanonicalJsonValue(output)) {
    return {
      outcome: "ERROR",
      evaluatorResults: { reason: "invalid_output" },
    };
  }

  if (evaluator.type === "JSON_EXACT_MATCH") {
    const expectedValue = evaluator.expected ?? expected;
    if (expectedValue === undefined) {
      return {
        outcome: "ERROR",
        evaluatorResults: { reason: "missing_expected_value" },
      };
    }

    const passed = jsonValuesEqual(output, expectedValue);
    return {
      outcome: passed ? "PASS" : "FAIL",
      evaluatorResults: {
        type: "JSON_EXACT_MATCH",
        passed,
      },
    };
  }

  return {
    outcome: "ERROR",
    evaluatorResults: {
      reason: "unsupported_evaluator",
      type: evaluator.type,
    },
  };
}

async function reconcileEvaluationRunStatus(
  deps: EvaluationRunApplicationDependencies,
  evaluationRunId: EvaluationRunId,
  now: Date,
): Promise<void> {
  const evaluationRun =
    await deps.evaluationSuites.findEvaluationRunById(evaluationRunId);
  if (
    evaluationRun === null ||
    evaluationRun.status === "COMPLETED" ||
    evaluationRun.status === "FAILED" ||
    evaluationRun.status === "CANCELLED"
  ) {
    return;
  }

  const suiteVersion = await deps.evaluationSuites.findSuiteVersionById(
    evaluationRun.evaluationSuiteVersionId,
  );
  if (suiteVersion === null) {
    return;
  }

  const caseResults =
    await deps.evaluationSuites.listCaseResultsByEvaluationRun(evaluationRunId);

  if (caseResults.length < suiteVersion.cases.length) {
    return;
  }

  const hasError = caseResults.some((result) => result.outcome === "ERROR");
  const nextStatus = hasError ? "FAILED" : "COMPLETED";
  const next = evaluationRun.transitionTo(nextStatus, {
    updatedAt: now,
    completedAt: now,
  });

  await deps.evaluationSuites.transitionEvaluationRun(
    evaluationRun.status,
    next,
  );
}

function buildEvaluationRunSummary(
  totalCases: number,
  caseResults: readonly EvaluationCaseResult[],
): EvaluationRunSummary {
  const passedCases = caseResults.filter(
    (result) => result.outcome === "PASS",
  ).length;
  const failedCases = caseResults.filter(
    (result) => result.outcome === "FAIL",
  ).length;
  const errorCases = caseResults.filter(
    (result) => result.outcome === "ERROR",
  ).length;
  const completedCases = caseResults.length;
  const pendingCases = Math.max(totalCases - completedCases, 0);

  return {
    totalCases,
    pendingCases,
    runningCases: 0,
    completedCases,
    passedCases,
    failedCases,
    errorCases,
    passRate: totalCases === 0 ? 0 : passedCases / totalCases,
    inputTokens: 0,
    outputTokens: 0,
    pricedCostUsdMicros: 0,
    unpricedModelCalls: 0,
  };
}
