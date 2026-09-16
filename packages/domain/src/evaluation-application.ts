import type {
  EvaluationId,
  EvaluatorConfig,
  JsonValue,
  RunAttemptId,
  RunId,
} from "@osva/contracts";
import { isCanonicalJsonValue } from "@osva/contracts";

import { Evaluation } from "./evaluation.js";
import {
  EvaluationNotFoundError,
  InvalidRunAttemptStateError,
  RunAttemptNotFoundError,
  RunNotFoundError,
} from "./errors.js";
import { jsonValuesEqual } from "./json-equality.js";
import type { EvaluationRepository } from "./ports/evaluation-repository.js";
import type { RunRepository } from "./ports/run-repository.js";

export interface EvaluationApplicationClock {
  now(): Date;
}

export interface EvaluationApplicationIds {
  createId(): string;
}

export interface EvaluationApplicationDependencies {
  readonly runs: RunRepository;
  readonly evaluations: EvaluationRepository;
  readonly clock: EvaluationApplicationClock;
  readonly ids: EvaluationApplicationIds;
}

export interface CreateEvaluationCommand {
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly evaluator: EvaluatorConfig;
}

export interface GetEvaluationCommand {
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly evaluationId: EvaluationId;
}

export class CreateEvaluation {
  constructor(private readonly deps: EvaluationApplicationDependencies) {}

  async execute(command: CreateEvaluationCommand): Promise<Evaluation> {
    const attempt = await loadSucceededAttempt(
      this.deps.runs,
      command.runId,
      command.runAttemptId,
    );

    if (attempt.output === undefined) {
      throw new InvalidRunAttemptStateError(
        command.runAttemptId,
        attempt.status,
        "SUCCEEDED",
      );
    }

    if (!isCanonicalJsonValue(attempt.output)) {
      throw new InvalidRunAttemptStateError(
        command.runAttemptId,
        attempt.status,
        "SUCCEEDED",
      );
    }

    const result = evaluateAttemptOutput(command.evaluator, attempt.output);

    const evaluation = Evaluation.create({
      id: this.deps.ids.createId() as EvaluationId,
      runId: command.runId,
      runAttemptId: command.runAttemptId,
      evaluatorType: command.evaluator.type,
      expected: command.evaluator.expected,
      passed: result.passed,
      score: result.score,
      createdAt: this.deps.clock.now(),
    });

    await this.deps.evaluations.saveEvaluation(evaluation);
    return evaluation;
  }
}

export class ListEvaluations {
  constructor(private readonly deps: EvaluationApplicationDependencies) {}

  async execute(
    runId: RunId,
    runAttemptId: RunAttemptId,
  ): Promise<readonly Evaluation[]> {
    await assertRunAttemptOwnership(this.deps.runs, runId, runAttemptId);

    const evaluations =
      await this.deps.evaluations.listEvaluationsByRunAttempt(runAttemptId);
    return evaluations.filter((evaluation) => evaluation.runId === runId);
  }
}

export class GetEvaluation {
  constructor(private readonly deps: EvaluationApplicationDependencies) {}

  async execute(command: GetEvaluationCommand): Promise<Evaluation> {
    await assertRunAttemptOwnership(
      this.deps.runs,
      command.runId,
      command.runAttemptId,
    );

    const evaluation = await this.deps.evaluations.findEvaluationById(
      command.evaluationId,
    );
    if (
      evaluation === null ||
      evaluation.runId !== command.runId ||
      evaluation.runAttemptId !== command.runAttemptId
    ) {
      throw new EvaluationNotFoundError(command.evaluationId);
    }

    return evaluation;
  }
}

export interface EvaluationApplication {
  readonly createEvaluation: CreateEvaluation;
  readonly listEvaluations: ListEvaluations;
  readonly getEvaluation: GetEvaluation;
}

export function createEvaluationApplication(
  deps: EvaluationApplicationDependencies,
): EvaluationApplication {
  return {
    createEvaluation: new CreateEvaluation(deps),
    listEvaluations: new ListEvaluations(deps),
    getEvaluation: new GetEvaluation(deps),
  };
}

async function loadSucceededAttempt(
  runs: RunRepository,
  runId: RunId,
  runAttemptId: RunAttemptId,
) {
  const run = await runs.findRunById(runId);
  if (run === null) {
    throw new RunNotFoundError(runId);
  }

  const attempt = await runs.findRunAttemptById(runAttemptId);
  if (attempt === null || attempt.runId !== runId) {
    throw new RunAttemptNotFoundError(runAttemptId);
  }

  if (attempt.status !== "SUCCEEDED") {
    throw new InvalidRunAttemptStateError(
      runAttemptId,
      attempt.status,
      "SUCCEEDED",
    );
  }

  return attempt;
}

async function assertRunAttemptOwnership(
  runs: RunRepository,
  runId: RunId,
  runAttemptId: RunAttemptId,
): Promise<void> {
  const run = await runs.findRunById(runId);
  if (run === null) {
    throw new RunNotFoundError(runId);
  }

  const attempt = await runs.findRunAttemptById(runAttemptId);
  if (attempt === null || attempt.runId !== runId) {
    throw new RunAttemptNotFoundError(runAttemptId);
  }
}

function evaluateAttemptOutput(
  evaluator: EvaluatorConfig,
  actual: JsonValue,
): { readonly passed: boolean; readonly score: number } {
  if (evaluator.type === "JSON_EXACT_MATCH") {
    const passed = jsonValuesEqual(actual, evaluator.expected);
    return { passed, score: passed ? 1 : 0 };
  }

  return { passed: false, score: 0 };
}
