import { describe, expect, it, afterAll, beforeAll, beforeEach } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import {
  createDefaultJudgeInvoker,
  createJudgeAcceptanceFixture,
  reconcileChildAndExpectJudgeTask,
  runEvaluationRecoveryPass,
} from "./judge-acceptance-harness.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

describe("PostgreSQL judge attempt billing replay", () => {
  let context: PostgresTestContext;
  let database: Database;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 4,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
  });

  afterAll(async () => {
    await database?.close();
    if (context) {
      await stopPostgresForTests(context);
    }
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
  });

  it("does not inflate totals when duplicate attempt rows are replayed", async () => {
    const fixture = await createJudgeAcceptanceFixture(database);
    await reconcileChildAndExpectJudgeTask(fixture);
    const task = await fixture.judgeTasks.findJudgeTaskByRunAndCase(
      fixture.seed.evaluationRunId,
      fixture.seed.evaluationCaseId,
    );
    const claimed = await fixture.judgeTasks.claimJudgeTaskLease({
      taskId: task!.id,
      workspaceId: task!.workspaceId,
      owner: "billing",
      generation: 1,
      leaseExpiresAt: new Date(fixture.clock.now().getTime() + 5_000),
      now: fixture.clock.now(),
    });
    await fixture.judgeTasks.appendJudgeInvocationAttempt({
      taskId: task!.id,
      workspaceId: task!.workspaceId,
      executionGeneration: claimed!.executionGeneration,
      attempt: {
        attemptNumber: 1,
        outcome: "provider_error",
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        configuredProviderModelId: "gpt-4o-mini",
        providerReportedModelId: "gpt-4o-mini",
        providerResponseId: null,
        usageIncomplete: false,
        pricedCostUsdMicros: 50,
        unpricedModelCalls: 0,
      },
    });
    await fixture.judgeTasks.appendJudgeInvocationAttempt({
      taskId: task!.id,
      workspaceId: task!.workspaceId,
      executionGeneration: claimed!.executionGeneration,
      attempt: {
        attemptNumber: 1,
        outcome: "provider_error",
        inputTokens: 9_999,
        outputTokens: 9_999,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        configuredProviderModelId: "gpt-4o-mini",
        providerReportedModelId: "gpt-4o-mini",
        providerResponseId: null,
        usageIncomplete: false,
        pricedCostUsdMicros: 9_999,
        unpricedModelCalls: 0,
      },
    });

    fixture.clock.advanceMs(6_000);
    fixture.setJudgeInvoker(createDefaultJudgeInvoker("valid"));
    await fixture.createJudgeProcessor("billing-2").execute({ batchLimit: 5 });

    const caseResult =
      await fixture.deps.evaluationSuites.findCaseResultByRunAndCase(
        fixture.seed.evaluationRunId,
        fixture.seed.evaluationCaseId,
      );
    const judgeUsage = caseResult?.evaluatorResults.judgeUsageAccounting as
      { readonly inputTokens?: number } | undefined;
    expect(judgeUsage?.inputTokens).toBe(220);

    const tokensBefore = judgeUsage?.inputTokens;
    await runEvaluationRecoveryPass(fixture, "billing-replay");
    const after =
      await fixture.deps.evaluationSuites.findCaseResultByRunAndCase(
        fixture.seed.evaluationRunId,
        fixture.seed.evaluationCaseId,
      );
    const afterUsage = after?.evaluatorResults.judgeUsageAccounting as
      { readonly inputTokens?: number } | undefined;
    expect(afterUsage?.inputTokens).toBe(tokensBefore);
  });
});
