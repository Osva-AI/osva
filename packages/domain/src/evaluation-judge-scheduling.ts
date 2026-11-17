import type { EvaluationJudgeTaskId } from "@osva-ai/contracts";
import { parseEvaluatorConfig } from "@osva-ai/contracts";

import {
  parseJudgeBackedEvaluatorConfig,
  resolvedJudgeBackedMaxOutputTokens,
  resolvedJudgeBackedMinPassingScore,
} from "./judge-backed-evaluator.js";

import type { EvaluationCase } from "./evaluation-case.js";
import { EvaluationJudgeTask } from "./evaluation-judge-task.js";
import type { EvaluationRunApplicationIds } from "./evaluation-run-application.js";
import { computeJudgeBackedRubricIdentity } from "./rag-judge/rubric-identity.js";
import type { EvaluationJudgeTaskRepository } from "./ports/evaluation-judge-task-repository.js";
import type { RunAttempt } from "./run-attempt.js";
import type { Run } from "./run.js";

export function parseLlmJudgeEvaluatorConfig(
  evaluator: unknown,
): import("@osva-ai/contracts").LlmJudgeEvaluatorConfig | null {
  const config = parseJudgeBackedEvaluatorConfig(evaluator);
  if (config === null || config.type !== "LLM_JUDGE") {
    return null;
  }
  return config;
}

export async function ensureJudgeBackedTaskForTerminalRun(
  judgeTasks: EvaluationJudgeTaskRepository,
  ids: EvaluationRunApplicationIds,
  input: {
    readonly run: Run;
    readonly attempt: RunAttempt;
    readonly evaluationCase: EvaluationCase;
    readonly evaluationSuiteVersionId: string;
    readonly now: Date;
  },
): Promise<EvaluationJudgeTask | null> {
  const config = parseJudgeBackedEvaluatorConfig(
    input.evaluationCase.evaluator,
  );
  if (config === null) {
    return null;
  }

  if (input.attempt.status !== "SUCCEEDED") {
    return null;
  }

  const existing = await judgeTasks.findJudgeTaskByRunAndCase(
    input.run.evaluationRunId!,
    input.run.evaluationCaseId!,
  );
  if (existing !== null) {
    return existing;
  }

  const minPassingScore = resolvedJudgeBackedMinPassingScore(config);
  const rubricIdentity = computeJudgeBackedRubricIdentity({
    evaluationSuiteVersionId: input.evaluationSuiteVersionId as never,
    config,
    resolvedMinPassingScore: minPassingScore,
  });

  const task = EvaluationJudgeTask.create({
    id: ids.createId() as EvaluationJudgeTaskId,
    workspaceId: input.run.workspaceId,
    evaluationRunId: input.run.evaluationRunId!,
    evaluationCaseId: input.run.evaluationCaseId!,
    runId: input.run.id,
    runAttemptId: input.attempt.id,
    snapshot: {
      evaluatorConfig: parseEvaluatorConfig(config) as unknown as Readonly<
        Record<string, unknown>
      >,
      rubricIdentity,
      minPassingScore,
      maxOutputTokens: resolvedJudgeBackedMaxOutputTokens(config),
      evaluationSuiteVersionId: input.evaluationSuiteVersionId,
      caseInput: input.evaluationCase.input,
      caseExpected: input.evaluationCase.expected,
    },
    createdAt: input.now,
  });

  await judgeTasks.saveJudgeTaskIfAbsent(task);
  return (
    (await judgeTasks.findJudgeTaskByRunAndCase(
      input.run.evaluationRunId!,
      input.run.evaluationCaseId!,
    )) ?? task
  );
}

export async function ensureLlmJudgeTaskForTerminalRun(
  ...args: Parameters<typeof ensureJudgeBackedTaskForTerminalRun>
): Promise<EvaluationJudgeTask | null> {
  return ensureJudgeBackedTaskForTerminalRun(...args);
}
