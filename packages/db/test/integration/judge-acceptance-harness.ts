import type {
  EvaluationCaseId,
  EvaluationQualityGatePolicyV1,
  EvaluationRunId,
  EvaluationSuiteId,
  EvaluationSuiteVersionId,
  JobQueue,
  ModelProfileId,
  ModelProfileVersionId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  DEFAULT_EVALUATION_JUDGE_LEASE_MS,
  EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION,
} from "@osva-ai/contracts";
import {
  Agent,
  AgentVersion,
  EvaluationCase,
  EvaluationSuite,
  EvaluationSuiteVersion,
  GetEvaluationRun,
  ModelProfile,
  ModelProfileVersion,
  ProcessEvaluationJudgeTasks,
  ReconcileEvaluationCase,
  RecoverEvaluationRuns,
  Run,
  RunAttempt,
  Workspace,
  createEvaluationRunApplication,
  runtimeControlPlaneScope,
  type EvaluationJudgeModelInvoker,
  type EvaluationRunApplicationDependencies,
} from "@osva/domain";
import { expect } from "vitest";

import type { Database } from "../../src/database.js";
import { PostgresAgentRepository } from "../../src/repositories/postgres-agent-repository.js";
import { PostgresEvaluationJudgeTaskRepository } from "../../src/repositories/postgres-evaluation-judge-task-repository.js";
import { PostgresEvaluationSuiteRepository } from "../../src/repositories/postgres-evaluation-suite-repository.js";
import { PostgresModelProfileRepository } from "../../src/repositories/postgres-model-profile-repository.js";
import { PostgresRunRepository } from "../../src/repositories/postgres-run-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { createBindings, createManifest, NOW } from "./fixtures.js";

export class MutableClock {
  private current: Date;

  constructor(start: Date) {
    this.current = start;
  }

  now(): Date {
    return this.current;
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class NoopJobQueue implements JobQueue {
  async enqueue(): Promise<{ readonly outcome: "enqueued" }> {
    return { outcome: "enqueued" };
  }
  async cancel(): Promise<void> {}
  async consume(): Promise<void> {
    throw new Error("not used");
  }
  async shutdown(): Promise<void> {}
}

export interface JudgeAcceptanceSeed {
  readonly workspaceId: WorkspaceId;
  readonly evaluationRunId: EvaluationRunId;
  readonly evaluationCaseId: EvaluationCaseId;
  readonly suiteVersionId: EvaluationSuiteVersionId;
  readonly modelProfileVersionId: ModelProfileVersionId;
  readonly childRunId: RunId;
  readonly childRunAttemptId: RunAttemptId;
}

export interface JudgeAcceptanceFixture {
  readonly clock: MutableClock;
  readonly judgeTasks: PostgresEvaluationJudgeTaskRepository;
  readonly deps: EvaluationRunApplicationDependencies;
  readonly reconcile: ReconcileEvaluationCase;
  readonly getEvaluationRun: GetEvaluationRun;
  readonly seed: JudgeAcceptanceSeed;
  currentJudgeInvoker(): EvaluationJudgeModelInvoker;
  setJudgeInvoker(invoker: EvaluationJudgeModelInvoker): void;
  createJudgeProcessor(owner: string): ProcessEvaluationJudgeTasks;
}

let idCounter = 0;

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function createDefaultJudgeInvoker(
  mode: "valid" | "malformed" | "slow" = "valid",
): EvaluationJudgeModelInvoker {
  return {
    generateJudgeCompletion: async () => {
      if (mode === "slow") {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return {
        text:
          mode === "malformed"
            ? "not-json"
            : JSON.stringify({
                score: 0.85,
                reason: "Correct arithmetic.",
                evidence: ["Answer matches expectation."],
              }),
        inputTokens: 120,
        outputTokens: 40,
        providerReportedModelId: "gpt-4o-mini",
        configuredProviderModelId: "gpt-4o-mini",
      };
    },
  };
}

export async function createJudgeAcceptanceFixture(
  database: Database,
  options?: {
    readonly judgeMode?: "valid" | "malformed";
    readonly crossWorkspaceModel?: boolean;
    readonly maxJudgeAttempts?: number;
  },
): Promise<JudgeAcceptanceFixture> {
  const clock = new MutableClock(NOW);
  const workspaces = new PostgresWorkspaceRepository(database);
  const suites = new PostgresEvaluationSuiteRepository(database);
  const agents = new PostgresAgentRepository(database);
  const runs = new PostgresRunRepository(database);
  const modelProfiles = new PostgresModelProfileRepository(database);
  const judgeTasks = new PostgresEvaluationJudgeTaskRepository(database);
  const queue = new NoopJobQueue();

  const workspaceId = "ws-judge-acceptance" as WorkspaceId;
  await workspaces.save(
    Workspace.create({
      id: workspaceId,
      name: "Judge Acceptance",
      createdAt: clock.now(),
    }),
  );

  const mpvId = "mpv-judge-acceptance" as ModelProfileVersionId;
  const mpId = "mp-judge-acceptance" as ModelProfileId;
  await modelProfiles.saveModelProfile(
    ModelProfile.create({
      id: mpId,
      workspaceId,
      key: "judge",
      name: "Judge",
      createdAt: clock.now(),
    }),
  );
  await modelProfiles.saveModelProfileVersion(
    ModelProfileVersion.create({
      id: mpvId,
      modelProfileId: mpId,
      version: 1,
      provider: "OPENAI",
      model: "gpt-4o-mini",
      pricing: {
        currency: "USD",
        inputUsdMicrosPerMillionTokens: 1_000_000,
        outputUsdMicrosPerMillionTokens: 2_000_000,
        cachedReadInputUsdMicrosPerMillionTokens: 100_000,
      },
      createdAt: clock.now(),
    }),
  );

  let evaluatorMpv = mpvId;
  if (options?.crossWorkspaceModel === true) {
    const otherWs = "ws-judge-other" as WorkspaceId;
    await workspaces.save(
      Workspace.create({
        id: otherWs,
        name: "Other",
        createdAt: clock.now(),
      }),
    );
    const otherMpId = "mp-other" as ModelProfileId;
    const otherMpvId = "mpv-other-ws" as ModelProfileVersionId;
    await modelProfiles.saveModelProfile(
      ModelProfile.create({
        id: otherMpId,
        workspaceId: otherWs,
        key: "other",
        name: "Other",
        createdAt: clock.now(),
      }),
    );
    await modelProfiles.saveModelProfileVersion(
      ModelProfileVersion.create({
        id: otherMpvId,
        modelProfileId: otherMpId,
        version: 1,
        provider: "OPENAI",
        model: "gpt-4o-mini",
        createdAt: clock.now(),
      }),
    );
    evaluatorMpv = otherMpvId;
  }

  const agent = Agent.create({
    id: "agent-judge-acceptance" as never,
    workspaceId,
    key: "target",
    name: "Target",
    createdAt: clock.now(),
  });
  await agents.saveAgent(agent);
  const agentVersion = AgentVersion.create({
    id: "av-judge-acceptance" as never,
    agentId: agent.id,
    version: 1,
    manifest: createManifest(),
    createdAt: clock.now(),
  });
  await agents.saveAgentVersion(agentVersion);

  const suiteId = "es-judge-acceptance" as EvaluationSuiteId;
  const suiteVersionId = "esv-judge-acceptance" as EvaluationSuiteVersionId;
  const evaluationCaseId = "ec-judge-acceptance" as EvaluationCaseId;

  await suites.saveSuite(
    EvaluationSuite.create({
      id: suiteId,
      workspaceId,
      key: "judge",
      name: "Judge Suite",
      createdAt: clock.now(),
      updatedAt: clock.now(),
    }),
  );

  await suites.saveSuiteVersion(
    EvaluationSuiteVersion.create({
      id: suiteVersionId,
      evaluationSuiteId: suiteId,
      workspaceId,
      version: 1,
      cases: [
        EvaluationCase.create({
          id: evaluationCaseId,
          evaluationSuiteVersionId: suiteVersionId,
          key: "only",
          input: { prompt: "What is 2+2?" },
          evaluator: {
            type: "LLM_JUDGE",
            rubric: "Score factual accuracy from 0 to 1.",
            modelProfileVersionId: evaluatorMpv,
            minPassingScore: 0.7,
          },
          createdAt: clock.now(),
        }),
      ],
      createdAt: clock.now(),
    }),
  );

  const qualityGatePolicy: EvaluationQualityGatePolicyV1 = {
    schemaVersion: EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION,
    rules: [
      {
        metric: "ESTIMATED_COST_USD_MICROS",
        operator: "MAX",
        threshold: 50_000_000,
      },
    ],
  };

  let judgeInvoker = createDefaultJudgeInvoker(options?.judgeMode ?? "valid");

  const deps: EvaluationRunApplicationDependencies = {
    evaluationSuites: suites,
    runs,
    agents,
    queue,
    clock,
    ids: { createId: () => nextId("id") },
    judgeTasks,
    modelProfiles,
  };

  const application = createEvaluationRunApplication(deps);
  const launch = application.launchEvaluationRun;
  const reconcile = application.reconcileEvaluationCase;
  const getEvaluationRun = application.getEvaluationRun;

  const scope = runtimeControlPlaneScope(workspaceId);
  const evaluationRun = await launch.execute(scope, {
    workspaceId,
    evaluationSuiteVersionId: suiteVersionId,
    targetType: "AGENT_VERSION",
    targetVersionId: agentVersion.id,
    qualityGatePolicy,
  });

  const childRunId = nextId("run") as RunId;
  const childRunAttemptId = nextId("ra") as RunAttemptId;
  const bindings = createBindings(agentVersion.id, mpvId);
  await runs.saveRun(
    Run.rehydrate({
      id: childRunId,
      workspaceId,
      agentId: agent.id,
      status: "SUCCEEDED",
      effectiveBindings: bindings,
      input: { prompt: "What is 2+2?" },
      createdAt: clock.now(),
      updatedAt: clock.now(),
      evaluationRunId: evaluationRun.id,
      evaluationCaseId,
    }),
  );
  await runs.saveRunAttempt(
    RunAttempt.rehydrate({
      id: childRunAttemptId,
      runId: childRunId,
      sequence: 1,
      status: "SUCCEEDED",
      output: "4",
      createdAt: clock.now(),
    }),
  );

  const fixture: JudgeAcceptanceFixture = {
    clock,
    judgeTasks,
    deps,
    reconcile,
    getEvaluationRun,
    seed: {
      workspaceId,
      evaluationRunId: evaluationRun.id,
      evaluationCaseId,
      suiteVersionId,
      modelProfileVersionId: mpvId,
      childRunId,
      childRunAttemptId,
    },
    currentJudgeInvoker: () => judgeInvoker,
    setJudgeInvoker(invoker: EvaluationJudgeModelInvoker) {
      judgeInvoker = invoker;
    },
    createJudgeProcessor(owner: string) {
      return new ProcessEvaluationJudgeTasks({
        ...deps,
        judgeTasks,
        judgeModel: judgeInvoker,
        modelProfiles: modelProfiles,
        executionOwner: owner,
        leaseTtlMs: DEFAULT_EVALUATION_JUDGE_LEASE_MS,
      });
    },
  };

  return fixture;
}

export async function reconcileChildAndExpectJudgeTask(
  fixture: JudgeAcceptanceFixture,
): Promise<void> {
  const scope = runtimeControlPlaneScope(fixture.seed.workspaceId);
  await fixture.reconcile.execute(scope, {
    runId: fixture.seed.childRunId,
    runAttemptId: fixture.seed.childRunAttemptId,
  });

  const task = await fixture.judgeTasks.findJudgeTaskByRunAndCase(
    fixture.seed.evaluationRunId,
    fixture.seed.evaluationCaseId,
  );
  expect(task).not.toBeNull();
  expect(task?.status).toBe("PENDING");

  const caseResult =
    await fixture.deps.evaluationSuites.findCaseResultByRunAndCase(
      fixture.seed.evaluationRunId,
      fixture.seed.evaluationCaseId,
    );
  expect(caseResult).toBeNull();
}

export async function runEvaluationRecoveryPass(
  fixture: JudgeAcceptanceFixture,
  judgeOwner: string,
): Promise<void> {
  const recover = new RecoverEvaluationRuns({
    ...fixture.deps,
    reconcileEvaluationCase: fixture.reconcile,
  });
  await recover.execute({ batchLimit: 10 });
  await fixture.createJudgeProcessor(judgeOwner).execute({ batchLimit: 10 });
}

export async function pollUntil<T>(
  deadlineMs: number,
  sample: () => Promise<T | null | undefined>,
): Promise<T> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const value = await sample();
    if (value !== null && value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("pollUntil deadline exceeded");
}
