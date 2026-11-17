import type {
  JsonSchemaRecord,
  ModelProfileVersionId,
} from "@osva-ai/contracts";
import {
  DEFAULT_EVALUATION_JUDGE_LEASE_MS,
  DEFAULT_EVALUATION_JUDGE_MAX_CONCURRENT_TASKS,
  resolveEvaluationJudgeModelCallTimeoutMs,
} from "@osva-ai/contracts";

import { buildPairwiseComparisonPrompt } from "./comparison/pairwise-prompt.js";
import {
  PAIRWISE_VERDICT_JSON_SCHEMA,
  parsePairwiseVerdictJson,
} from "./comparison/pairwise-verdict.js";
import type { EvaluationComparisonApplicationDependencies } from "./evaluation-comparison-application.js";
import { ReconcileEvaluationComparison } from "./evaluation-comparison-reconciliation.js";
import type { EvaluationComparisonPairwiseTask } from "./evaluation-comparison-pairwise-task.js";
import {
  aggregateJudgeInvocationAttempts,
  judgeUsageAccountingFromInvocation,
  type JudgeInvocationAttemptRecord,
} from "./evaluation-judge-accounting.js";
import { assertLlmJudgeModelAuthorized } from "./llm-judge/authorize.js";
import type { EvaluationComparisonPairwiseTaskRepository } from "./ports/evaluation-comparison-pairwise-task-repository.js";
import type { EvaluationComparisonRepository } from "./ports/evaluation-comparison-repository.js";
import type { EvaluationJudgeModelInvoker } from "./ports/evaluation-judge-model-invoker.js";
import type { ModelProfileRepository } from "./ports/model-profile-repository.js";

export interface ProcessEvaluationComparisonPairwiseTasksDependencies extends EvaluationComparisonApplicationDependencies {
  readonly comparisons: EvaluationComparisonRepository;
  readonly pairwiseTasks: EvaluationComparisonPairwiseTaskRepository;
  readonly judgeModel: EvaluationJudgeModelInvoker;
  readonly modelProfiles: ModelProfileRepository;
  readonly executionOwner: string;
  readonly leaseTtlMs?: number;
  readonly modelCallTimeoutMs?: number;
  readonly maxConcurrentTasks?: number;
}

function loadPersistedPairwiseInvocationAttempts(
  task: EvaluationComparisonPairwiseTask,
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

export class ProcessEvaluationComparisonPairwiseTasks {
  private readonly leaseTtlMs: number;
  private readonly modelCallTimeoutMs: number;
  private readonly maxConcurrentTasks: number;
  private readonly reconcile: ReconcileEvaluationComparison;
  private readonly shutdownAbort = new AbortController();
  private readonly invocationAborts = new Set<AbortController>();

  constructor(
    private readonly deps: ProcessEvaluationComparisonPairwiseTasksDependencies,
  ) {
    this.reconcile = new ReconcileEvaluationComparison(deps);
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

    const pendingReconcile =
      await this.deps.comparisons.listComparisonsPendingReconciliation(limit);
    for (const comparison of pendingReconcile) {
      await this.reconcile.execute(comparison.id, comparison.workspaceId);
      processed += 1;
    }

    const candidates =
      await this.deps.pairwiseTasks.listPairwiseTasksForRecovery(limit, now);
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
          const claimed = await this.deps.pairwiseTasks.claimPairwiseTaskLease({
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
            // Task row records terminal errors.
          }
        }
      });
      await Promise.all(workers);
    }

    return processed;
  }

  private async executeClaimed(
    task: EvaluationComparisonPairwiseTask,
    now: Date,
  ): Promise<void> {
    const comparison =
      await this.deps.comparisons.findComparisonByWorkspaceAndId(
        task.workspaceId,
        task.comparisonId,
      );
    if (comparison === null) {
      await this.failTask(task, "comparison_not_found", now);
      return;
    }
    if (comparison.status === "FAILED" || comparison.status === "COMPLETED") {
      return;
    }
    if (comparison.pairwiseConfig?.enabled !== true) {
      await this.failTask(task, "pairwise_disabled", now);
      return;
    }

    const snapshot = task.snapshot;
    if (
      snapshot.baselineAnswer === undefined ||
      snapshot.baselineAnswer === null ||
      snapshot.candidateAnswer === undefined ||
      snapshot.candidateAnswer === null
    ) {
      await this.failTask(task, "pairwise_evidence_missing", now);
      return;
    }

    try {
      await assertLlmJudgeModelAuthorized(
        this.deps.modelProfiles,
        task.workspaceId,
        {
          modelProfileVersionId:
            snapshot.modelProfileVersionId as ModelProfileVersionId,
        },
      );
    } catch {
      await this.failTask(task, "pairwise_model_unauthorized", now);
      return;
    }

    const profileVersion =
      await this.deps.modelProfiles.findModelProfileVersionById(
        snapshot.modelProfileVersionId as ModelProfileVersionId,
      );
    if (profileVersion === null) {
      await this.failTask(task, "pairwise_model_not_found", now);
      return;
    }

    const prompt = buildPairwiseComparisonPrompt({
      rubric: snapshot.rubric,
      instructions: snapshot.instructions,
      caseInput: snapshot.caseInput,
      caseExpected: snapshot.caseExpected,
      baselineAnswer: snapshot.baselineAnswer,
      candidateAnswer: snapshot.candidateAnswer,
      judgmentPosition: task.judgmentPosition,
    });

    const invocationAttempts = loadPersistedPairwiseInvocationAttempts(task);
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
        new DOMException("Pairwise model call timed out.", "TimeoutError"),
      );
    }, this.modelCallTimeoutMs);

    let modelOutcome:
      | import("./ports/evaluation-judge-model-invoker.js").EvaluationJudgeModelInvokeResult
      | undefined;
    let completionText: string | undefined;

    try {
      modelOutcome = await this.deps.judgeModel.generateJudgeCompletion(
        {
          modelProfileVersionId:
            snapshot.modelProfileVersionId as ModelProfileVersionId,
          messages: [{ role: "user", content: prompt }],
          maxOutputTokens: snapshot.maxOutputTokens,
          jsonSchema: PAIRWISE_VERDICT_JSON_SCHEMA as JsonSchemaRecord,
        },
        { signal: invocationAbort.signal },
      );
      completionText = modelOutcome.text;
    } catch (error) {
      const emptyOutcome: import("./ports/evaluation-judge-model-invoker.js").EvaluationJudgeModelInvokeResult =
        {};
      const attemptRecord = judgeUsageAccountingFromInvocation(
        profileVersion,
        snapshot.modelProfileVersionId,
        emptyOutcome,
        task.attemptCount,
        "provider_error",
      );
      invocationAttempts.push(attemptRecord);
      await this.deps.pairwiseTasks.appendPairwiseInvocationAttempt({
        taskId: task.id,
        workspaceId: task.workspaceId,
        executionGeneration: task.executionGeneration,
        attempt: { ...attemptRecord },
      });

      if (
        isRetryableModelError(error) &&
        task.attemptCount < task.maxAttempts
      ) {
        const pending = task.withPendingRetry({ updatedAt: now });
        await this.deps.pairwiseTasks.savePairwiseTaskTerminal(pending);
        return;
      }
      await this.failTask(
        task,
        "pairwise_provider_error",
        now,
        invocationAttempts,
        snapshot.modelProfileVersionId,
      );
      return;
    } finally {
      clearTimeout(timeoutHandle);
      this.invocationAborts.delete(invocationAbort);
    }

    const completedAttempt = judgeUsageAccountingFromInvocation(
      profileVersion,
      snapshot.modelProfileVersionId as ModelProfileVersionId,
      modelOutcome,
      task.attemptCount,
      "completed",
    );
    invocationAttempts.push(completedAttempt);
    await this.deps.pairwiseTasks.appendPairwiseInvocationAttempt({
      taskId: task.id,
      workspaceId: task.workspaceId,
      executionGeneration: task.executionGeneration,
      attempt: { ...completedAttempt },
    });

    const verdictParse = parsePairwiseVerdictJson(
      completionText ?? "",
      task.judgmentPosition,
    );
    if (!verdictParse.ok) {
      if (task.attemptCount < task.maxAttempts) {
        const pending = task.withPendingRetry({ updatedAt: now });
        await this.deps.pairwiseTasks.savePairwiseTaskTerminal(pending);
        return;
      }
      await this.failTask(
        task,
        verdictParse.errorCode,
        now,
        invocationAttempts,
        snapshot.modelProfileVersionId,
      );
      return;
    }

    const usageAggregate = aggregateJudgeInvocationAttempts(
      snapshot.modelProfileVersionId as ModelProfileVersionId,
      invocationAttempts,
    );

    const succeeded = task.withSucceeded({
      updatedAt: now,
      terminalResult: {
        verdict: {
          slotPreference: verdictParse.verdict.slotPreference,
          canonicalPreference: verdictParse.verdict.canonicalPreference,
          reason: verdictParse.verdict.reason,
          evidence: verdictParse.verdict.evidence,
          ...(verdictParse.verdict.confidence === undefined
            ? {}
            : { confidence: verdictParse.verdict.confidence }),
          rubricIdentity: snapshot.rubricIdentity,
        },
        judgeUsageAccounting: usageAggregate.judgeUsageAccounting,
        invocationAttempts: usageAggregate.judgeInvocationAttempts,
      },
    });
    if (!(await this.deps.pairwiseTasks.savePairwiseTaskTerminal(succeeded))) {
      return;
    }

    await this.reconcile.execute(task.comparisonId, task.workspaceId);
  }

  private async failTask(
    task: EvaluationComparisonPairwiseTask,
    errorCode: string,
    now: Date,
    invocationAttempts: JudgeInvocationAttemptRecord[] = [],
    modelProfileVersionId?: string,
  ): Promise<void> {
    const usageAggregate =
      invocationAttempts.length > 0 && modelProfileVersionId !== undefined
        ? aggregateJudgeInvocationAttempts(
            modelProfileVersionId,
            invocationAttempts,
          )
        : undefined;

    const failed = task.withFailed({
      errorCode,
      updatedAt: now,
      ...(usageAggregate === undefined
        ? {}
        : {
            terminalResult: {
              judgeUsageAccounting: usageAggregate.judgeUsageAccounting,
              invocationAttempts: usageAggregate.judgeInvocationAttempts,
            },
          }),
    });
    if (!(await this.deps.pairwiseTasks.savePairwiseTaskTerminal(failed))) {
      return;
    }

    await this.reconcile.execute(task.comparisonId, task.workspaceId);
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
    message.includes("forbidden") ||
    message.includes("invalid_api_key")
  ) {
    return false;
  }
  return true;
}
