import type { JobQueue } from "@osva-ai/contracts";
import type {
  AgentVersionId,
  EvaluationCaseOutcome,
  EvaluationQualityGatePolicyV1,
  EvaluationRunId,
  EvaluationRunQualityGateV1,
  EvaluationRunTargetType,
  EvaluationSuiteVersionId,
  JsonValue,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { AUTHORIZATION_ACTIONS } from "@osva-ai/contracts";

import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "./control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "./control-plane-resource-kinds.js";

const EVALUATION_RUN_RESOURCE = {
  kind: CONTROL_PLANE_RESOURCE_KINDS.evaluationRun,
};
import { evaluateDeterministicEvaluator } from "./deterministic-evaluators/evaluate.js";
import { assertCanonicalRunOutput } from "./deterministic-evaluators/output.js";
import { shouldFinalizeEvaluationCaseResult } from "./evaluation-run-case-finalization.js";
import { ensureJudgeBackedTaskForTerminalRun } from "./evaluation-judge-scheduling.js";
import { parseJudgeBackedEvaluatorConfig } from "./judge-backed-evaluator.js";
import { assertLlmJudgeModelAuthorized } from "./llm-judge/authorize.js";
import {
  materializeEvaluationChildRun,
  ensureEvaluationLaunchMaterialized,
} from "./evaluation-run-launch.js";
import {
  reconcileParentTerminalState,
  recoverEvaluationRunQualityGate,
} from "./evaluation-run-recovery.js";
import { EvaluationCaseResult } from "./evaluation-case-result.js";
import { EvaluationRun } from "./evaluation-run.js";
import { resolveEvaluationRunQualityGate } from "./evaluation-run-quality-gate.js";
import { loadEvaluationRunUsageMeasurement } from "./evaluation-run-usage-loader.js";
import {
  aggregateEvaluationRunSummary,
  reconcileCaseResultsForScoring,
  type EvaluationRunSummary,
} from "./evaluation-run-scoring.js";
import {
  AgentNotFoundError,
  AgentVersionNotFoundError,
  EvaluationCaseNotFoundError,
  EvaluationRunNotFoundError,
  EvaluationSuiteVersionNotFoundError,
  RunAttemptNotFoundError,
  RunNotFoundError,
} from "./errors.js";
import type { AgentRepository } from "./ports/agent-repository.js";
import type {
  EvaluationSuiteRepository,
  ListEvaluationRunsQuery,
  ListEvaluationRunsResult,
} from "./ports/evaluation-suite-repository.js";
import { MAX_EVALUATION_RUN_LIST_LIMIT } from "./ports/evaluation-suite-repository.js";
import type { EvaluationJudgeTaskRepository } from "./ports/evaluation-judge-task-repository.js";
import type { ModelProfileRepository } from "./ports/model-profile-repository.js";
import type { RunRepository } from "./ports/run-repository.js";
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
  readonly judgeTasks?: EvaluationJudgeTaskRepository;
  readonly modelProfiles?: ModelProfileRepository;
}

export interface LaunchEvaluationRunCommand {
  readonly workspaceId: WorkspaceId;
  readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;
  readonly targetType: EvaluationRunTargetType;
  readonly targetVersionId: string;
  readonly qualityGatePolicy?: EvaluationQualityGatePolicyV1;
}

export interface ReconcileEvaluationCaseCommand {
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
}

export class LaunchEvaluationRun {
  constructor(private readonly deps: EvaluationRunApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: LaunchEvaluationRunCommand,
  ): Promise<EvaluationRun> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.EXECUTE,
      EVALUATION_RUN_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const suiteVersion = await this.deps.evaluationSuites.findSuiteVersionById(
      command.evaluationSuiteVersionId,
    );
    if (suiteVersion === null || suiteVersion.workspaceId !== workspaceId) {
      throw new EvaluationSuiteVersionNotFoundError(
        command.evaluationSuiteVersionId,
      );
    }

    if (command.targetType !== "AGENT_VERSION") {
      throw new Error("Only AGENT_VERSION evaluation targets are supported.");
    }

    const agentVersion = await this.loadAgentVersion(
      workspaceId,
      command.targetVersionId as AgentVersionId,
    );

    const now = this.deps.clock.now();
    const evaluationRun = EvaluationRun.create({
      id: this.deps.ids.createId() as EvaluationRunId,
      workspaceId,
      evaluationSuiteVersionId: command.evaluationSuiteVersionId,
      targetType: command.targetType,
      targetVersionId: command.targetVersionId,
      qualityGatePolicy: command.qualityGatePolicy,
      createdAt: now,
    });

    await this.deps.evaluationSuites.saveEvaluationRun(evaluationRun);

    const cases = [...suiteVersion.cases].sort((left, right) =>
      left.key.localeCompare(right.key),
    );

    for (const evaluationCase of cases) {
      const judgeBacked = parseJudgeBackedEvaluatorConfig(
        evaluationCase.evaluator,
      );
      if (judgeBacked !== null) {
        if (this.deps.modelProfiles === undefined) {
          throw new Error(
            "Judge-backed evaluation requires model profile repository access at launch.",
          );
        }
        await assertLlmJudgeModelAuthorized(
          this.deps.modelProfiles,
          workspaceId,
          judgeBacked,
        );
      }

      await materializeEvaluationChildRun(this.deps, {
        workspaceId,
        agentVersion,
        evaluationRunId: evaluationRun.id,
        evaluationCase,
        now,
      });
    }

    await ensureEvaluationLaunchMaterialized(
      this.deps,
      evaluationRun,
      suiteVersion,
      agentVersion.id,
      now,
    );

    const stored = await this.deps.evaluationSuites.findEvaluationRunById(
      evaluationRun.id,
    );
    if (stored === null) {
      throw new EvaluationRunNotFoundError(evaluationRun.id);
    }
    return stored;
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

    const agent = await this.deps.agents.findAgentByWorkspaceAndId(
      workspaceId,
      agentVersion.agentId,
    );
    if (agent === null) {
      throw new AgentNotFoundError(agentVersion.agentId);
    }

    return agentVersion;
  }
}

export class ListEvaluationRuns {
  constructor(private readonly deps: EvaluationRunApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    query: Omit<ListEvaluationRunsQuery, "workspaceId">,
  ): Promise<ListEvaluationRunsResult> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      EVALUATION_RUN_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    assertEvaluationRunListLimit(query.limit);
    return this.deps.evaluationSuites.listEvaluationRuns({
      ...query,
      workspaceId,
    });
  }
}

export class GetEvaluationRun {
  constructor(private readonly deps: EvaluationRunApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    evaluationRunId: EvaluationRunId,
  ): Promise<{
    readonly evaluationRun: EvaluationRun;
    readonly summary: EvaluationRunSummary;
    readonly qualityGate?: EvaluationRunQualityGateV1;
  }> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      EVALUATION_RUN_RESOURCE,
    );
    const evaluationRun =
      await this.deps.evaluationSuites.findEvaluationRunByWorkspaceAndId(
        controlPlaneWorkspaceId(scope),
        evaluationRunId,
      );
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

    const reconciled = reconcileCaseResultsForScoring(caseResults);
    const usage = await loadEvaluationRunUsageMeasurement(
      this.deps.runs,
      controlPlaneWorkspaceId(scope),
      evaluationRun,
      reconciled,
    );

    const summary = aggregateEvaluationRunSummary(
      suiteVersion.cases.length,
      caseResults,
      usage,
    );
    const now = this.deps.clock.now();
    const qualityGate = await resolveEvaluationRunQualityGate(
      this.deps,
      evaluationRun,
      summary,
      now,
    );

    return {
      evaluationRun,
      summary,
      qualityGate,
    };
  }
}

export class ListEvaluationCaseResults {
  constructor(private readonly deps: EvaluationRunApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    evaluationRunId: EvaluationRunId,
  ): Promise<readonly EvaluationCaseResult[]> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      EVALUATION_RUN_RESOURCE,
    );
    const evaluationRun =
      await this.deps.evaluationSuites.findEvaluationRunByWorkspaceAndId(
        controlPlaneWorkspaceId(scope),
        evaluationRunId,
      );
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

  async execute(
    scope: ControlPlaneScope,
    command: ReconcileEvaluationCaseCommand,
  ): Promise<void> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.EXECUTE,
      EVALUATION_RUN_RESOURCE,
    );
    const run = await this.deps.runs.findRunByWorkspaceAndId(
      controlPlaneWorkspaceId(scope),
      command.runId,
    );
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

    if (!shouldFinalizeEvaluationCaseResult(run, attempt)) {
      return;
    }

    const existing =
      await this.deps.evaluationSuites.findCaseResultByRunAndCase(
        run.evaluationRunId,
        run.evaluationCaseId,
      );
    if (existing !== null) {
      await reconcileParentTerminalState(
        this.deps,
        run.evaluationRunId,
        await loadSuiteCaseCount(this.deps, run.evaluationRunId),
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

    const evaluationRun =
      await this.deps.evaluationSuites.findEvaluationRunById(
        run.evaluationRunId,
      );
    const suiteVersion =
      evaluationRun === null
        ? null
        : await this.deps.evaluationSuites.findSuiteVersionById(
            evaluationRun.evaluationSuiteVersionId,
          );

    const judgeBackedConfig = parseJudgeBackedEvaluatorConfig(
      evaluationCase.evaluator,
    );
    const now = this.deps.clock.now();

    if (
      judgeBackedConfig !== null &&
      attempt.status === "SUCCEEDED" &&
      this.deps.judgeTasks !== undefined &&
      suiteVersion !== null &&
      assertCanonicalRunOutput(attempt.output)
    ) {
      await ensureJudgeBackedTaskForTerminalRun(
        this.deps.judgeTasks,
        this.deps.ids,
        {
          run,
          attempt,
          evaluationCase,
          evaluationSuiteVersionId: suiteVersion.id,
          now,
        },
      );
      await reconcileParentTerminalState(
        this.deps,
        run.evaluationRunId,
        suiteVersion.cases.length,
        now,
      );
      return;
    }

    const { outcome, evaluatorResults } = evaluateTerminalAttempt(
      attempt.status,
      attempt.output,
      evaluationCase.expected,
      evaluationCase.evaluator as unknown as Readonly<Record<string, unknown>>,
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
    const totalCases = await loadSuiteCaseCount(this.deps, run.evaluationRunId);
    await reconcileParentTerminalState(
      this.deps,
      run.evaluationRunId,
      totalCases,
      now,
    );
    await recoverEvaluationRunQualityGate(
      this.deps,
      run.workspaceId,
      run.evaluationRunId,
      totalCases,
      now,
    );
  }
}

export type { EvaluationRunSummary } from "./evaluation-run-scoring.js";

export interface EvaluationRunApplication {
  readonly launchEvaluationRun: LaunchEvaluationRun;
  readonly listEvaluationRuns: ListEvaluationRuns;
  readonly getEvaluationRun: GetEvaluationRun;
  readonly listEvaluationCaseResults: ListEvaluationCaseResults;
  readonly reconcileEvaluationCase: ReconcileEvaluationCase;
}

export function createEvaluationRunApplication(
  deps: EvaluationRunApplicationDependencies,
): EvaluationRunApplication {
  return {
    launchEvaluationRun: new LaunchEvaluationRun(deps),
    listEvaluationRuns: new ListEvaluationRuns(deps),
    getEvaluationRun: new GetEvaluationRun(deps),
    listEvaluationCaseResults: new ListEvaluationCaseResults(deps),
    reconcileEvaluationCase: new ReconcileEvaluationCase(deps),
  };
}

function assertEvaluationRunListLimit(limit: number): void {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_EVALUATION_RUN_LIST_LIMIT
  ) {
    throw new Error(
      `Evaluation run list limit must be an integer between 1 and ${String(MAX_EVALUATION_RUN_LIST_LIMIT)}.`,
    );
  }
}

async function loadSuiteCaseCount(
  deps: EvaluationRunApplicationDependencies,
  evaluationRunId: EvaluationRunId,
): Promise<number> {
  const evaluationRun =
    await deps.evaluationSuites.findEvaluationRunById(evaluationRunId);
  if (evaluationRun === null) {
    return 0;
  }
  const suiteVersion = await deps.evaluationSuites.findSuiteVersionById(
    evaluationRun.evaluationSuiteVersionId,
  );
  return suiteVersion?.cases.length ?? 0;
}

function evaluateTerminalAttempt(
  attemptStatus: string,
  output: unknown,
  expected: JsonValue | undefined,
  evaluator: unknown,
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

  return evaluateDeterministicEvaluator(evaluator, output, expected);
}
