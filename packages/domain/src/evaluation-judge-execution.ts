import type { JsonValue } from "@osva-ai/contracts";
import {
  DEFAULT_EVALUATION_JUDGE_LEASE_MS,
  DEFAULT_EVALUATION_JUDGE_MAX_CONCURRENT_TASKS,
  resolveEvaluationJudgeModelCallTimeoutMs,
  safeParseEvaluatorConfig,
} from "@osva-ai/contracts";

import { EvaluationCaseResult } from "./evaluation-case-result.js";
import type { EvaluationRunApplicationDependencies } from "./evaluation-run-application.js";
import {
  reconcileParentTerminalState,
  recoverEvaluationRunQualityGate,
} from "./evaluation-run-recovery.js";
import {
  aggregateJudgeInvocationAttempts,
  judgeUsageAccountingFromInvocation,
  type JudgeInvocationAttemptRecord,
} from "./evaluation-judge-accounting.js";
import { assertCanonicalRunOutput } from "./deterministic-evaluators/output.js";
import { assertLlmJudgeModelAuthorized } from "./llm-judge/authorize.js";
import { deriveJudgePassFail } from "./llm-judge/verdict.js";
import type { JudgeBackedEvaluatorConfig } from "./judge-backed-evaluator.js";
import { isJudgeBackedEvaluatorConfig } from "./judge-backed-evaluator.js";
import { buildJudgeMetricPlan } from "./rag-judge/dispatch.js";
import {
  implementationVersionForJudgeBacked,
  promptTemplateVersionForJudgeBacked,
} from "./rag-judge/rubric-identity.js";
import type { EvaluationJudgeTaskRepository } from "./ports/evaluation-judge-task-repository.js";
import type { EvaluationJudgeModelInvoker } from "./ports/evaluation-judge-model-invoker.js";
import type { ModelProfileRepository } from "./ports/model-profile-repository.js";

export { DEFAULT_EVALUATION_JUDGE_LEASE_MS };

function loadPersistedJudgeInvocationAttempts(
  task: import("./evaluation-judge-task.js").EvaluationJudgeTask,
): JudgeInvocationAttemptRecord[] {
  const raw = task.terminalResult?.invocationAttempts;
  if (!Array.isArray(raw)) {
    return [];
  }

  const attempts: JudgeInvocationAttemptRecord[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") {
      continue;
    }
    const record = item as Readonly<Record<string, unknown>>;
    if (
      typeof record.attemptNumber !== "number" ||
      (record.outcome !== "completed" &&
        record.outcome !== "provider_error" &&
        record.outcome !== "invalid_verdict")
    ) {
      continue;
    }

    attempts.push({
      attemptNumber: record.attemptNumber,
      outcome: record.outcome,
      inputTokens:
        typeof record.inputTokens === "number" ? record.inputTokens : 0,
      outputTokens:
        typeof record.outputTokens === "number" ? record.outputTokens : 0,
      cachedInputTokens:
        typeof record.cachedInputTokens === "number"
          ? record.cachedInputTokens
          : 0,
      cacheWriteInputTokens:
        typeof record.cacheWriteInputTokens === "number"
          ? record.cacheWriteInputTokens
          : 0,
      configuredProviderModelId:
        typeof record.configuredProviderModelId === "string"
          ? record.configuredProviderModelId
          : null,
      providerReportedModelId:
        typeof record.providerReportedModelId === "string"
          ? record.providerReportedModelId
          : null,
      providerResponseId:
        typeof record.providerResponseId === "string"
          ? record.providerResponseId
          : null,
      usageIncomplete: record.usageIncomplete === true,
      pricedCostUsdMicros:
        typeof record.pricedCostUsdMicros === "number"
          ? record.pricedCostUsdMicros
          : 0,
      unpricedModelCalls:
        typeof record.unpricedModelCalls === "number"
          ? record.unpricedModelCalls
          : 0,
    });
  }

  return attempts;
}

export interface ProcessEvaluationJudgeTasksDependencies extends EvaluationRunApplicationDependencies {
  readonly judgeTasks: EvaluationJudgeTaskRepository;
  readonly judgeModel: EvaluationJudgeModelInvoker;
  readonly modelProfiles: ModelProfileRepository;
  readonly executionOwner: string;
  readonly leaseTtlMs?: number;
  readonly modelCallTimeoutMs?: number;
  readonly maxConcurrentTasks?: number;
}

export class ProcessEvaluationJudgeTasks {
  private readonly leaseTtlMs: number;
  private readonly modelCallTimeoutMs: number;
  private readonly maxConcurrentTasks: number;
  private readonly shutdownAbort = new AbortController();
  private readonly invocationAborts = new Set<AbortController>();

  constructor(private readonly deps: ProcessEvaluationJudgeTasksDependencies) {
    this.leaseTtlMs = deps.leaseTtlMs ?? DEFAULT_EVALUATION_JUDGE_LEASE_MS;
    this.modelCallTimeoutMs = resolveEvaluationJudgeModelCallTimeoutMs({
      leaseTtlMs: this.leaseTtlMs,
      modelCallTimeoutMs: deps.modelCallTimeoutMs,
    });
    this.maxConcurrentTasks =
      deps.maxConcurrentTasks ?? DEFAULT_EVALUATION_JUDGE_MAX_CONCURRENT_TASKS;
    if (this.maxConcurrentTasks < 1) {
      throw new Error("maxConcurrentTasks must be at least 1.");
    }
  }

  abortInFlight(): void {
    this.shutdownAbort.abort();
    for (const controller of this.invocationAborts) {
      controller.abort();
    }
  }

  async execute(input?: { readonly batchLimit?: number }): Promise<number> {
    const limit = input?.batchLimit ?? 20;
    const now = this.deps.clock.now();
    let processed = 0;

    const orphaned =
      await this.deps.judgeTasks.listTerminalJudgeTasksMissingCaseResult(limit);
    for (const task of orphaned) {
      if (await this.materializeOrphanedTerminalTask(task, now)) {
        processed += 1;
      }
    }

    const candidates = await this.deps.judgeTasks.listJudgeTasksForRecovery(
      limit,
      now,
    );
    if (candidates.length > 0) {
      const parallelLimit = Math.min(
        this.maxConcurrentTasks,
        candidates.length,
      );
      let index = 0;
      const workers = Array.from({ length: parallelLimit }, async () => {
        while (index < candidates.length) {
          if (this.shutdownAbort.signal.aborted) {
            return;
          }
          const currentIndex = index;
          index += 1;
          const candidate = candidates[currentIndex];
          if (candidate === undefined) {
            continue;
          }
          const claimed = await this.deps.judgeTasks.claimJudgeTaskLease({
            taskId: candidate.id,
            workspaceId: candidate.workspaceId,
            owner: this.deps.executionOwner,
            generation: candidate.executionGeneration + 1,
            leaseExpiresAt: new Date(now.getTime() + this.leaseTtlMs),
            now,
          });
          if (claimed === null) {
            continue;
          }

          try {
            await this.executeClaimed(claimed, now);
            processed += 1;
          } catch {
            // Individual task failures are persisted on the task row.
          }
        }
      });
      await Promise.all(workers);
    }

    return processed;
  }

  private async executeClaimed(
    task: import("./evaluation-judge-task.js").EvaluationJudgeTask,
    now: Date,
  ): Promise<void> {
    const parentRun = await this.deps.evaluationSuites.findEvaluationRunById(
      task.evaluationRunId,
    );
    if (parentRun === null || parentRun.status === "CANCELLED") {
      return;
    }

    const attempt = await this.deps.runs.findRunAttemptById(task.runAttemptId);
    if (attempt === null || attempt.status !== "SUCCEEDED") {
      await this.failTask(task, "target_attempt_unavailable", now);
      return;
    }

    if (!assertCanonicalRunOutput(attempt.output)) {
      await this.failTask(task, "target_output_invalid", now);
      return;
    }

    const parsedConfig = safeParseEvaluatorConfig(
      task.snapshot.evaluatorConfig,
    );
    if (
      !parsedConfig.success ||
      !isJudgeBackedEvaluatorConfig(parsedConfig.data)
    ) {
      await this.failTask(task, "judge_invalid_config", now);
      return;
    }

    const config: JudgeBackedEvaluatorConfig = parsedConfig.data;
    try {
      await assertLlmJudgeModelAuthorized(
        this.deps.modelProfiles,
        task.workspaceId,
        config,
      );
    } catch {
      await this.persistEvaluatorError(task, "judge_model_unauthorized", now);
      return;
    }

    const profileVersion =
      await this.deps.modelProfiles.findModelProfileVersionById(
        config.modelProfileVersionId,
      );
    if (profileVersion === null) {
      await this.persistEvaluatorError(task, "judge_model_not_found", now);
      return;
    }

    const metricPlanResult = buildJudgeMetricPlan({
      config,
      minPassingScore: task.snapshot.minPassingScore,
      caseInput: task.snapshot.caseInput as JsonValue,
      caseExpected: task.snapshot.caseExpected as JsonValue | undefined,
      targetOutput: attempt.output,
    });
    if (!metricPlanResult.ok) {
      await this.persistEvaluatorError(task, metricPlanResult.errorCode, now);
      return;
    }
    const metricPlan = metricPlanResult.plan;

    const invocationAttempts = loadPersistedJudgeInvocationAttempts(task);

    let completionText: string | undefined;
    let modelOutcome:
      | import("./ports/evaluation-judge-model-invoker.js").EvaluationJudgeModelInvokeResult
      | undefined;

    const invocationAbort = new AbortController();
    this.invocationAborts.add(invocationAbort);
    if (this.shutdownAbort.signal.aborted) {
      invocationAbort.abort();
    }
    this.shutdownAbort.signal.addEventListener("abort", () => {
      invocationAbort.abort();
    });
    const timeoutHandle = setTimeout(() => {
      invocationAbort.abort(
        new DOMException("Judge model call timed out.", "TimeoutError"),
      );
    }, this.modelCallTimeoutMs);

    try {
      modelOutcome = await this.deps.judgeModel.generateJudgeCompletion(
        {
          modelProfileVersionId: config.modelProfileVersionId,
          messages: [{ role: "user", content: metricPlan.prompt }],
          maxOutputTokens: task.snapshot.maxOutputTokens,
          jsonSchema:
            metricPlan.jsonSchema as import("@osva-ai/contracts").JsonSchemaRecord,
        },
        { signal: invocationAbort.signal },
      );
      completionText = modelOutcome.text;
    } catch (error) {
      const emptyOutcome: import("./ports/evaluation-judge-model-invoker.js").EvaluationJudgeModelInvokeResult =
        {};
      const attemptRecord = judgeUsageAccountingFromInvocation(
        profileVersion,
        config.modelProfileVersionId,
        emptyOutcome,
        task.attemptCount,
        "provider_error",
      );
      invocationAttempts.push(attemptRecord);
      await this.deps.judgeTasks.appendJudgeInvocationAttempt({
        taskId: task.id,
        workspaceId: task.workspaceId,
        executionGeneration: task.executionGeneration,
        attempt: { ...attemptRecord },
      });

      const retryable = isRetryableModelError(error);
      if (retryable && task.attemptCount < task.maxAttempts) {
        const pending = task.withPendingRetry({ updatedAt: now });
        if (await this.deps.judgeTasks.saveJudgeTaskTerminal(pending)) {
          return;
        }
        return;
      }
      await this.persistEvaluatorError(
        task,
        "judge_provider_error",
        now,
        invocationAttempts,
        config.modelProfileVersionId,
        profileVersion.model,
      );
      return;
    } finally {
      clearTimeout(timeoutHandle);
      this.invocationAborts.delete(invocationAbort);
    }

    const completedAttempt = judgeUsageAccountingFromInvocation(
      profileVersion,
      config.modelProfileVersionId,
      modelOutcome,
      task.attemptCount,
      "completed",
    );
    invocationAttempts.push(completedAttempt);
    await this.deps.judgeTasks.appendJudgeInvocationAttempt({
      taskId: task.id,
      workspaceId: task.workspaceId,
      executionGeneration: task.executionGeneration,
      attempt: { ...completedAttempt },
    });

    const rawText = completionText ?? "";
    const verdictParse = metricPlan.parseVerdict(rawText);
    if (!verdictParse.ok) {
      if (task.attemptCount < task.maxAttempts) {
        const pending = task.withPendingRetry({ updatedAt: now });
        if (await this.deps.judgeTasks.saveJudgeTaskTerminal(pending)) {
          return;
        }
        return;
      }
      await this.persistEvaluatorError(
        task,
        verdictParse.errorCode,
        now,
        invocationAttempts,
        config.modelProfileVersionId,
        profileVersion.model,
      );
      return;
    }

    const passed = deriveJudgePassFail(
      verdictParse.score,
      task.snapshot.minPassingScore,
    );

    const usageAggregate = aggregateJudgeInvocationAttempts(
      config.modelProfileVersionId,
      invocationAttempts,
    );

    const succeeded = task.withSucceeded({
      updatedAt: now,
      terminalResult: {
        verdict: {
          score: verdictParse.score,
          reason: verdictParse.reason,
          evidence: verdictParse.evidence,
          ...(verdictParse.confidence === undefined
            ? {}
            : { confidence: verdictParse.confidence }),
          ...(verdictParse.metricDetails === undefined
            ? {}
            : { metricDetails: verdictParse.metricDetails }),
          passed,
          rubricIdentity: task.snapshot.rubricIdentity,
          minPassingScore: task.snapshot.minPassingScore,
        },
        judgeUsageAccounting: usageAggregate.judgeUsageAccounting,
        invocationAttempts: usageAggregate.judgeInvocationAttempts,
      },
    });
    if (!(await this.deps.judgeTasks.saveJudgeTaskTerminal(succeeded))) {
      return;
    }

    const providerModelId = modelOutcome.providerReportedModelId;
    const providerResponseId = modelOutcome.providerResponseId;

    const result = EvaluationCaseResult.create({
      id: this.deps.ids.createId() as EvaluationCaseResult["id"],
      evaluationRunId: task.evaluationRunId,
      evaluationCaseId: task.evaluationCaseId,
      runId: task.runId,
      outcome: passed ? "PASS" : "FAIL",
      evaluatorResults: {
        type: config.type,
        status: "COMPLETED",
        score: verdictParse.score,
        passed,
        reason: verdictParse.reason,
        evidence: verdictParse.evidence,
        ...(verdictParse.confidence === undefined
          ? {}
          : { confidence: verdictParse.confidence }),
        ...(verdictParse.metricDetails === undefined
          ? {}
          : { metricDetails: verdictParse.metricDetails }),
        rubricIdentity: task.snapshot.rubricIdentity,
        modelProfileVersionId: config.modelProfileVersionId,
        promptTemplateVersion: promptTemplateVersionForJudgeBacked(config),
        implementationVersion: implementationVersionForJudgeBacked(config),
        ...usageAggregate,
        judgeModelProvenance: {
          configuredModel: profileVersion.model,
          providerReportedModelId: providerModelId ?? null,
          providerResponseId: providerResponseId ?? null,
        },
      },
      createdAt: now,
      completedAt: now,
    });

    await this.deps.evaluationSuites.saveCaseResult(result);

    const evaluationRun =
      await this.deps.evaluationSuites.findEvaluationRunById(
        task.evaluationRunId,
      );
    if (evaluationRun === null) {
      return;
    }
    const suiteVersion = await this.deps.evaluationSuites.findSuiteVersionById(
      evaluationRun.evaluationSuiteVersionId,
    );
    const totalCases = suiteVersion?.cases.length ?? 0;

    await reconcileParentTerminalState(
      this.deps,
      task.evaluationRunId,
      totalCases,
      now,
    );
    await recoverEvaluationRunQualityGate(
      this.deps,
      task.workspaceId,
      task.evaluationRunId,
      totalCases,
      now,
    );
  }

  private async failTask(
    task: import("./evaluation-judge-task.js").EvaluationJudgeTask,
    errorCode: string,
    now: Date,
  ): Promise<void> {
    const failed = task.withFailed({ errorCode, updatedAt: now });
    if (!(await this.deps.judgeTasks.saveJudgeTaskTerminal(failed))) {
      return;
    }
    await this.persistEvaluatorError(failed, errorCode, now);
  }

  private async persistEvaluatorError(
    task: import("./evaluation-judge-task.js").EvaluationJudgeTask,
    errorCode: string,
    now: Date,
    invocationAttempts: JudgeInvocationAttemptRecord[] = [],
    modelProfileVersionId?: string,
    configuredModel?: string,
  ): Promise<void> {
    if (task.status === "RUNNING") {
      const failed = task.withFailed({ errorCode, updatedAt: now });
      if (!(await this.deps.judgeTasks.saveJudgeTaskTerminal(failed))) {
        return;
      }
      task = failed;
    }

    const existing =
      await this.deps.evaluationSuites.findCaseResultByRunAndCase(
        task.evaluationRunId,
        task.evaluationCaseId,
      );
    if (existing !== null) {
      return;
    }

    const usageAggregate =
      invocationAttempts.length > 0 && modelProfileVersionId !== undefined
        ? aggregateJudgeInvocationAttempts(
            modelProfileVersionId,
            invocationAttempts,
          )
        : undefined;

    const parsedSnapshot = safeParseEvaluatorConfig(
      task.snapshot.evaluatorConfig,
    );
    const evaluatorType =
      parsedSnapshot.success &&
      isJudgeBackedEvaluatorConfig(parsedSnapshot.data)
        ? parsedSnapshot.data.type
        : "LLM_JUDGE";
    const implementationVersion =
      parsedSnapshot.success &&
      isJudgeBackedEvaluatorConfig(parsedSnapshot.data)
        ? implementationVersionForJudgeBacked(parsedSnapshot.data)
        : "a3.0";

    const result = EvaluationCaseResult.create({
      id: this.deps.ids.createId() as EvaluationCaseResult["id"],
      evaluationRunId: task.evaluationRunId,
      evaluationCaseId: task.evaluationCaseId,
      runId: task.runId,
      outcome: "ERROR",
      evaluatorResults: {
        type: evaluatorType,
        status: "ERROR",
        errorCode,
        implementationVersion,
        rubricIdentity: task.snapshot.rubricIdentity,
        ...(usageAggregate ?? {}),
        ...(configuredModel === undefined
          ? {}
          : {
              judgeModelProvenance: {
                configuredModel,
                providerReportedModelId: null,
                providerResponseId: null,
              },
            }),
      },
      createdAt: now,
      completedAt: now,
    });

    await this.deps.evaluationSuites.saveCaseResult(result);

    const evaluationRun =
      await this.deps.evaluationSuites.findEvaluationRunById(
        task.evaluationRunId,
      );
    if (evaluationRun === null) {
      return;
    }
    const suiteVersion = await this.deps.evaluationSuites.findSuiteVersionById(
      evaluationRun.evaluationSuiteVersionId,
    );
    const totalCases = suiteVersion?.cases.length ?? 0;
    await reconcileParentTerminalState(
      this.deps,
      task.evaluationRunId,
      totalCases,
      now,
    );
    await recoverEvaluationRunQualityGate(
      this.deps,
      task.workspaceId,
      task.evaluationRunId,
      totalCases,
      now,
    );
  }

  private async materializeOrphanedTerminalTask(
    task: import("./evaluation-judge-task.js").EvaluationJudgeTask,
    now: Date,
  ): Promise<boolean> {
    const existing =
      await this.deps.evaluationSuites.findCaseResultByRunAndCase(
        task.evaluationRunId,
        task.evaluationCaseId,
      );
    if (existing !== null) {
      return false;
    }

    if (task.status === "FAILED") {
      await this.persistEvaluatorError(
        task,
        task.errorCode ?? "judge_task_failed",
        now,
        [],
      );
      return true;
    }

    if (task.status !== "SUCCEEDED") {
      return false;
    }

    const verdict = task.terminalResult?.verdict as
      Readonly<Record<string, unknown>> | undefined;
    const score = verdict?.score;
    if (typeof score !== "number") {
      return false;
    }

    const passed =
      typeof verdict?.passed === "boolean"
        ? verdict.passed
        : deriveJudgePassFail(score, task.snapshot.minPassingScore);

    const parsedConfig = safeParseEvaluatorConfig(
      task.snapshot.evaluatorConfig,
    );
    if (
      !parsedConfig.success ||
      !isJudgeBackedEvaluatorConfig(parsedConfig.data)
    ) {
      return false;
    }

    const config: JudgeBackedEvaluatorConfig = parsedConfig.data;
    const invocationAttempts = task.terminalResult?.invocationAttempts ?? [];
    const usageAggregate =
      task.terminalResult?.judgeUsageAccounting !== undefined
        ? {
            judgeUsageAccounting: task.terminalResult.judgeUsageAccounting,
            ...(invocationAttempts.length > 0
              ? { judgeInvocationAttempts: invocationAttempts }
              : {}),
          }
        : {};

    const result = EvaluationCaseResult.create({
      id: this.deps.ids.createId() as EvaluationCaseResult["id"],
      evaluationRunId: task.evaluationRunId,
      evaluationCaseId: task.evaluationCaseId,
      runId: task.runId,
      outcome: passed ? "PASS" : "FAIL",
      evaluatorResults: {
        type: config.type,
        status: "COMPLETED",
        score,
        passed,
        reason:
          typeof verdict?.reason === "string" ? verdict.reason : "recovered",
        evidence: Array.isArray(verdict?.evidence)
          ? verdict.evidence.filter(
              (item): item is string => typeof item === "string",
            )
          : [],
        rubricIdentity: task.snapshot.rubricIdentity,
        modelProfileVersionId: config.modelProfileVersionId,
        promptTemplateVersion: promptTemplateVersionForJudgeBacked(config),
        implementationVersion: implementationVersionForJudgeBacked(config),
        ...usageAggregate,
      },
      createdAt: now,
      completedAt: now,
    });
    await this.deps.evaluationSuites.saveCaseResult(result);

    const evaluationRun =
      await this.deps.evaluationSuites.findEvaluationRunById(
        task.evaluationRunId,
      );
    if (evaluationRun === null) {
      return true;
    }
    const suiteVersion = await this.deps.evaluationSuites.findSuiteVersionById(
      evaluationRun.evaluationSuiteVersionId,
    );
    const totalCases = suiteVersion?.cases.length ?? 0;
    await reconcileParentTerminalState(
      this.deps,
      task.evaluationRunId,
      totalCases,
      now,
    );
    await recoverEvaluationRunQualityGate(
      this.deps,
      task.workspaceId,
      task.evaluationRunId,
      totalCases,
      now,
    );
    return true;
  }
}

function isRetryableModelError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  if (
    message.includes("unauthorized") ||
    message.includes("authentication") ||
    message.includes("forbidden")
  ) {
    return false;
  }
  return (
    message.includes("rate") ||
    message.includes("timeout") ||
    message.includes("abort")
  );
}
