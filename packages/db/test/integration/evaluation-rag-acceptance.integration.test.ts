import type {
  EvaluatorType,
  ModelProfileVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  Agent,
  AgentVersion,
  EvaluationCase,
  EvaluationSuite,
  EvaluationSuiteVersion,
  ModelProfile,
  ModelProfileVersion,
  ProcessEvaluationJudgeTasks,
  Run,
  RunAttempt,
  Workspace,
  createEvaluationRunApplication,
  runtimeControlPlaneScope,
  type EvaluationJudgeModelInvoker,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresAgentRepository } from "../../src/repositories/postgres-agent-repository.js";
import { PostgresEvaluationJudgeTaskRepository } from "../../src/repositories/postgres-evaluation-judge-task-repository.js";
import { PostgresEvaluationSuiteRepository } from "../../src/repositories/postgres-evaluation-suite-repository.js";
import { PostgresModelProfileRepository } from "../../src/repositories/postgres-model-profile-repository.js";
import { PostgresRunRepository } from "../../src/repositories/postgres-run-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import {
  MutableClock,
  NoopJobQueue,
  reconcileChildAndExpectJudgeTask,
} from "./judge-acceptance-harness.js";
import { createBindings, createManifest, NOW } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

const EXPECTED_V1 = {
  schemaVersion: "a4.0" as const,
  context: {
    chunks: [
      { id: "c1", text: "Paris is the capital of France.", rank: 1 },
      { id: "c2", text: "Berlin is in Germany.", rank: 2 },
    ],
  },
  referenceAnswer: "Paris is the capital of France.",
  referenceFacts: [
    { id: "f1", statement: "Paris is the capital of France." },
    { id: "f2", statement: "France is in Europe." },
  ],
};

function ragJudgeInvoker(
  evaluatorType: EvaluatorType,
): EvaluationJudgeModelInvoker {
  return {
    generateJudgeCompletion: async () => {
      let payload: unknown;
      switch (evaluatorType) {
        case "RAG_FAITHFULNESS":
          payload = {
            reason: "claims",
            claims: [
              {
                id: "cl1",
                statement: "Paris is the capital of France.",
                supported: true,
                supportingChunkIds: ["c1"],
              },
            ],
          };
          break;
        case "RAG_ANSWER_RELEVANCE":
          payload = {
            score: 0.9,
            reason: "Direct answer",
            evidence: ["Addresses capital question."],
          };
          break;
        case "RAG_CONTEXT_PRECISION":
          payload = {
            reason: "precision",
            chunkAssessments: [
              { chunkId: "c1", relevant: true },
              { chunkId: "c2", relevant: false },
            ],
          };
          break;
        case "RAG_CONTEXT_RECALL":
          payload = {
            reason: "recall",
            facts: [
              {
                id: "f1",
                statement: "Paris is the capital of France.",
                supported: true,
              },
              { id: "f2", statement: "France is in Europe.", supported: false },
            ],
          };
          break;
        case "SEMANTIC_SIMILARITY":
          payload = {
            score: 0.88,
            reason: "Equivalent meaning",
            evidence: ["Same fact about Paris."],
          };
          break;
        default:
          throw new Error(`unexpected evaluator type ${evaluatorType}`);
      }
      return {
        text: JSON.stringify(payload),
        inputTokens: 100,
        outputTokens: 60,
        providerReportedModelId: "gpt-4o-mini",
        configuredProviderModelId: "gpt-4o-mini",
      };
    },
  };
}

describe("PostgreSQL A4 RAG acceptance", () => {
  let context: PostgresTestContext;
  let database: Database;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 8,
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

  for (const evaluatorType of [
    "RAG_FAITHFULNESS",
    "RAG_ANSWER_RELEVANCE",
    "RAG_CONTEXT_PRECISION",
    "RAG_CONTEXT_RECALL",
    "SEMANTIC_SIMILARITY",
  ] as const) {
    it(`completes ${evaluatorType} judge flow`, async () => {
      const clock = new MutableClock(NOW);
      const workspaces = new PostgresWorkspaceRepository(database);
      const suites = new PostgresEvaluationSuiteRepository(database);
      const agents = new PostgresAgentRepository(database);
      const runs = new PostgresRunRepository(database);
      const modelProfiles = new PostgresModelProfileRepository(database);
      const judgeTasks = new PostgresEvaluationJudgeTaskRepository(database);
      const queue = new NoopJobQueue();

      const workspaceId = "ws-rag-acceptance" as WorkspaceId;
      await workspaces.save(
        Workspace.create({
          id: workspaceId,
          name: "RAG",
          createdAt: clock.now(),
        }),
      );

      const mpvId = "mpv-rag" as ModelProfileVersionId;
      await modelProfiles.saveModelProfile(
        ModelProfile.create({
          id: "mp-rag" as never,
          workspaceId,
          key: "judge",
          name: "Judge",
          createdAt: clock.now(),
        }),
      );
      await modelProfiles.saveModelProfileVersion(
        ModelProfileVersion.create({
          id: mpvId,
          modelProfileId: "mp-rag" as never,
          version: 1,
          provider: "OPENAI",
          model: "gpt-4o-mini",
          pricing: {
            currency: "USD",
            inputUsdMicrosPerMillionTokens: 1_000_000,
            outputUsdMicrosPerMillionTokens: 2_000_000,
          },
          createdAt: clock.now(),
        }),
      );

      const agent = Agent.create({
        id: "agent-rag" as never,
        workspaceId,
        key: "target",
        name: "Target",
        createdAt: clock.now(),
      });
      await agents.saveAgent(agent);
      const agentVersion = AgentVersion.create({
        id: "av-rag" as never,
        agentId: agent.id,
        version: 1,
        manifest: createManifest(),
        createdAt: clock.now(),
      });
      await agents.saveAgentVersion(agentVersion);

      const suiteVersionId = "esv-rag" as never;
      const evaluationCaseId = "ec-rag" as never;
      await suites.saveSuite(
        EvaluationSuite.create({
          id: "es-rag" as never,
          workspaceId,
          key: "rag",
          name: "RAG",
          createdAt: clock.now(),
          updatedAt: clock.now(),
        }),
      );
      await suites.saveSuiteVersion(
        EvaluationSuiteVersion.create({
          id: suiteVersionId,
          evaluationSuiteId: "es-rag" as never,
          workspaceId,
          version: 1,
          cases: [
            EvaluationCase.create({
              id: evaluationCaseId,
              evaluationSuiteVersionId: suiteVersionId,
              key: "case",
              input: { question: "What is the capital of France?" },
              expected: EXPECTED_V1,
              evaluator: {
                type: evaluatorType,
                modelProfileVersionId: mpvId,
                minPassingScore: 0.5,
              },
              createdAt: clock.now(),
            }),
          ],
          createdAt: clock.now(),
        }),
      );

      let idn = 0;
      const deps = {
        evaluationSuites: suites,
        runs,
        agents,
        queue,
        clock,
        ids: { createId: () => `id-${(idn += 1)}` },
        judgeTasks,
        modelProfiles,
      };

      const application = createEvaluationRunApplication(deps);
      const evaluationRun = await application.launchEvaluationRun.execute(
        runtimeControlPlaneScope(workspaceId),
        {
          workspaceId,
          evaluationSuiteVersionId: suiteVersionId,
          targetType: "AGENT_VERSION",
          targetVersionId: agentVersion.id,
        },
      );

      const childRunId = "run-rag" as never;
      const childRunAttemptId = "ra-rag" as never;
      await runs.saveRun(
        Run.rehydrate({
          id: childRunId,
          workspaceId,
          agentId: agent.id,
          status: "SUCCEEDED",
          effectiveBindings: createBindings(agentVersion.id, mpvId),
          input: { question: "What is the capital of France?" },
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
          output: "Paris is the capital of France.",
          createdAt: clock.now(),
        }),
      );

      const fixture = {
        deps,
        judgeTasks,
        reconcile: application.reconcileEvaluationCase,
        seed: {
          workspaceId,
          evaluationRunId: evaluationRun.id,
          evaluationCaseId,
          childRunId,
          childRunAttemptId,
        },
        currentJudgeInvoker: () => ragJudgeInvoker(evaluatorType),
        setJudgeInvoker: () => {},
        createJudgeProcessor: (owner: string) =>
          new ProcessEvaluationJudgeTasks({
            ...deps,
            judgeModel: ragJudgeInvoker(evaluatorType),
            modelProfiles,
            executionOwner: owner,
          }),
      };

      await reconcileChildAndExpectJudgeTask(fixture as never);
      await fixture
        .createJudgeProcessor("worker-rag")
        .execute({ batchLimit: 3 });

      const caseResult = await suites.findCaseResultByRunAndCase(
        evaluationRun.id,
        evaluationCaseId,
      );
      expect(caseResult?.evaluatorResults?.type).toBe(evaluatorType);
      expect(caseResult?.outcome).toBe("PASS");
      expect(caseResult?.evaluatorResults?.status).toBe("COMPLETED");
      expect(typeof caseResult?.evaluatorResults?.score).toBe("number");

      const parent = await suites.findEvaluationRunById(evaluationRun.id);
      expect(parent?.status).toBe("COMPLETED");
    });
  }

  it("malformed RAG faithfulness verdict becomes ERROR", async () => {
    const clock = new MutableClock(NOW);
    const suites = new PostgresEvaluationSuiteRepository(database);
    const runs = new PostgresRunRepository(database);
    const agents = new PostgresAgentRepository(database);
    const modelProfiles = new PostgresModelProfileRepository(database);
    const judgeTasks = new PostgresEvaluationJudgeTaskRepository(database);
    const workspaces = new PostgresWorkspaceRepository(database);
    const queue = new NoopJobQueue();

    const workspaceId = "ws-rag-bad" as WorkspaceId;
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Bad",
        createdAt: clock.now(),
      }),
    );
    const mpvId = "mpv-rag-bad" as ModelProfileVersionId;
    await modelProfiles.saveModelProfile(
      ModelProfile.create({
        id: "mp-bad" as never,
        workspaceId,
        key: "j",
        name: "J",
        createdAt: clock.now(),
      }),
    );
    await modelProfiles.saveModelProfileVersion(
      ModelProfileVersion.create({
        id: mpvId,
        modelProfileId: "mp-bad" as never,
        version: 1,
        provider: "OPENAI",
        model: "gpt-4o-mini",
        createdAt: clock.now(),
      }),
    );

    const agent = Agent.create({
      id: "agent-bad" as never,
      workspaceId,
      key: "t",
      name: "T",
      createdAt: clock.now(),
    });
    await agents.saveAgent(agent);
    const agentVersion = AgentVersion.create({
      id: "av-bad" as never,
      agentId: agent.id,
      version: 1,
      manifest: createManifest(),
      createdAt: clock.now(),
    });
    await agents.saveAgentVersion(agentVersion);

    const evaluationCaseId = "ec-bad" as never;
    const suiteVersionId = "esv-bad" as never;
    await suites.saveSuite(
      EvaluationSuite.create({
        id: "es-bad" as never,
        workspaceId,
        key: "b",
        name: "B",
        createdAt: clock.now(),
        updatedAt: clock.now(),
      }),
    );
    await suites.saveSuiteVersion(
      EvaluationSuiteVersion.create({
        id: suiteVersionId,
        evaluationSuiteId: "es-bad" as never,
        workspaceId,
        version: 1,
        cases: [
          EvaluationCase.create({
            id: evaluationCaseId,
            evaluationSuiteVersionId: suiteVersionId,
            key: "c",
            input: "Q?",
            expected: EXPECTED_V1,
            evaluator: {
              type: "RAG_FAITHFULNESS",
              modelProfileVersionId: mpvId,
            },
            createdAt: clock.now(),
          }),
        ],
        createdAt: clock.now(),
      }),
    );

    let idn = 0;
    const deps = {
      evaluationSuites: suites,
      runs,
      agents,
      queue,
      clock,
      ids: { createId: () => `id-b-${(idn += 1)}` },
      judgeTasks,
      modelProfiles,
    };
    const application = createEvaluationRunApplication(deps);
    const evaluationRun = await application.launchEvaluationRun.execute(
      runtimeControlPlaneScope(workspaceId),
      {
        workspaceId,
        evaluationSuiteVersionId: suiteVersionId,
        targetType: "AGENT_VERSION",
        targetVersionId: agentVersion.id,
      },
    );

    const childRunId = "run-bad" as never;
    await runs.saveRun(
      Run.rehydrate({
        id: childRunId,
        workspaceId,
        agentId: agent.id,
        status: "SUCCEEDED",
        effectiveBindings: createBindings(agentVersion.id, mpvId),
        input: "Q?",
        createdAt: clock.now(),
        updatedAt: clock.now(),
        evaluationRunId: evaluationRun.id,
        evaluationCaseId,
      }),
    );
    await runs.saveRunAttempt(
      RunAttempt.rehydrate({
        id: "ra-bad" as never,
        runId: childRunId,
        sequence: 1,
        status: "SUCCEEDED",
        output: "Paris",
        createdAt: clock.now(),
      }),
    );

    const badInvoker: EvaluationJudgeModelInvoker = {
      generateJudgeCompletion: async () => ({
        text: "not-json",
        inputTokens: 1,
        outputTokens: 1,
      }),
    };

    const fixture = {
      deps,
      judgeTasks,
      reconcile: application.reconcileEvaluationCase,
      seed: {
        workspaceId,
        evaluationRunId: evaluationRun.id,
        evaluationCaseId,
        childRunId,
        childRunAttemptId: "ra-bad" as never,
      },
      currentJudgeInvoker: () => badInvoker,
      setJudgeInvoker: () => {},
      createJudgeProcessor: (owner: string) =>
        new ProcessEvaluationJudgeTasks({
          ...deps,
          judgeModel: badInvoker,
          modelProfiles,
          executionOwner: owner,
        }),
    };

    await reconcileChildAndExpectJudgeTask(fixture as never);
    const taskBefore = await judgeTasks.findJudgeTaskByRunAndCase(
      evaluationRun.id,
      evaluationCaseId,
    );
    expect(taskBefore).not.toBeNull();
    await database.sql`
      update evaluation_judge_tasks set max_attempts = 1 where id = ${taskBefore!.id}
    `;
    await fixture.createJudgeProcessor("worker-bad").execute({ batchLimit: 1 });

    const caseResult = await suites.findCaseResultByRunAndCase(
      evaluationRun.id,
      evaluationCaseId,
    );
    expect(caseResult?.outcome).toBe("ERROR");
    expect(caseResult?.evaluatorResults?.type).toBe("RAG_FAITHFULNESS");
  });
});
