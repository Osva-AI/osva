import type {
  EvaluationCaseId,
  EvaluationJudgeTaskId,
  EvaluationRunId,
  ModelProfileId,
  ModelProfileVersionId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { DEFAULT_EVALUATION_JUDGE_LEASE_MS } from "@osva-ai/contracts";
import {
  Agent,
  AgentVersion,
  EffectiveRunBindings,
  EvaluationCase,
  EvaluationJudgeTask,
  EvaluationRun,
  EvaluationSuiteVersion,
  ModelProfile,
  ModelProfileVersion,
  ProcessEvaluationJudgeTasks,
  Run,
  RunAttempt,
  type EvaluationJudgeModelInvoker,
  type ModelProfileRepository,
} from "@osva/domain";
import {
  MemoryAgentRepository,
  MemoryEvaluationJudgeTaskRepository,
  MemoryEvaluationSuiteRepository,
  MemoryJobQueue,
  MemoryRunRepository,
} from "@osva/adapters-memory";
import { describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const WORKSPACE = "ws-judge-exec" as WorkspaceId;

function createManifest() {
  return {
    schemaVersion: "1" as const,
    key: "example-agent",
    name: "Example Agent",
    runtime: { type: "BUILTIN_PACKAGE" as const, key: "example-agent" },
    input: { schema: {} },
    output: { schema: {} },
    execution: { timeoutMs: 30_000, maxAttempts: 2 },
    capabilities: { model: false, tools: [] as const },
  };
}

class MapModelProfileRepository implements ModelProfileRepository {
  private profiles = new Map<ModelProfileId, ModelProfile>();
  private versions = new Map<ModelProfileVersionId, ModelProfileVersion>();

  async saveModelProfile(profile: ModelProfile): Promise<void> {
    this.profiles.set(profile.id, profile);
  }

  async findModelProfileById(id: ModelProfileId): Promise<ModelProfile | null> {
    return this.profiles.get(id) ?? null;
  }

  async findModelProfileByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: ModelProfileId,
  ): Promise<ModelProfile | null> {
    const profile = this.profiles.get(id);
    return profile?.workspaceId === workspaceId ? profile : null;
  }

  async listModelProfiles(): Promise<ModelProfile[]> {
    return [...this.profiles.values()];
  }

  async listModelProfilesByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<ModelProfile[]> {
    return [...this.profiles.values()].filter(
      (profile) => profile.workspaceId === workspaceId,
    );
  }

  async updateModelProfileMetadata(): Promise<ModelProfile | null> {
    return null;
  }

  async saveModelProfileVersion(version: ModelProfileVersion): Promise<void> {
    this.versions.set(version.id, version);
  }

  async appendModelProfileVersion(): Promise<ModelProfileVersion> {
    throw new Error("not implemented");
  }

  async findModelProfileVersionById(
    id: ModelProfileVersionId,
  ): Promise<ModelProfileVersion | null> {
    return this.versions.get(id) ?? null;
  }

  async listModelProfileVersions(
    modelProfileId: ModelProfileId,
  ): Promise<ModelProfileVersion[]> {
    return [...this.versions.values()].filter(
      (version) => version.modelProfileId === modelProfileId,
    );
  }
}

describe("ProcessEvaluationJudgeTasks", () => {
  it("persists PASS for valid verdict and ERROR for malformed verdict after retries", async () => {
    const deps = await seedExecutionFixture();
    let calls = 0;
    const judgeModel: EvaluationJudgeModelInvoker = {
      generateJudgeCompletion: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            text: JSON.stringify({
              score: 0.85,
              reason: "Good answer.",
              evidence: ["Matches rubric."],
            }),
            inputTokens: 100,
            outputTokens: 20,
            providerReportedModelId: "gpt-4o",
            configuredProviderModelId: "gpt-4o",
          };
        }
        return { text: "not-json" };
      },
    };

    const processor = new ProcessEvaluationJudgeTasks({
      ...deps.baseDeps,
      judgeTasks: deps.judgeTasks,
      judgeModel,
      modelProfiles: deps.modelProfiles,
      executionOwner: "worker-test",
    });

    const processed = await processor.execute({ batchLimit: 5 });
    expect(processed).toBe(1);
    expect(calls).toBe(1);
    const passResult = await deps.evaluationSuites.findCaseResultByRunAndCase(
      deps.evaluationRunId,
      deps.evaluationCaseId,
    );
    expect(passResult?.outcome).toBe("PASS");
    expect(passResult?.evaluatorResults.score).toBe(0.85);

    await deps.judgeTasks.saveJudgeTaskIfAbsent(deps.malformedTask());
    await processor.execute({ batchLimit: 5 });
    const errorResult = await deps.evaluationSuites.findCaseResultByRunAndCase(
      deps.evaluationRunId,
      "evaluation-case-malformed" as EvaluationCaseId,
    );
    expect(errorResult?.outcome).toBe("ERROR");
    expect(errorResult?.evaluatorResults.status).toBe("ERROR");
  });

  it("forwards AbortSignal and enforces model-call timeout below lease", async () => {
    const deps = await seedExecutionFixture();
    const signals: AbortSignal[] = [];
    const judgeModel: EvaluationJudgeModelInvoker = {
      generateJudgeCompletion: async (_request, options) => {
        if (options?.signal !== undefined) {
          signals.push(options.signal);
        }
        return await new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(new DOMException("timed out", "TimeoutError"));
          });
        });
      },
    };
    const processor = new ProcessEvaluationJudgeTasks({
      ...deps.baseDeps,
      judgeTasks: deps.judgeTasks,
      judgeModel,
      modelProfiles: deps.modelProfiles,
      executionOwner: "worker-timeout",
      leaseTtlMs: 20_000,
      modelCallTimeoutMs: 1_000,
    });
    await processor.execute({ batchLimit: 5 });
    expect(signals.length).toBeGreaterThan(0);
    const task = await deps.judgeTasks.findJudgeTaskByRunAndCase(
      deps.evaluationRunId,
      deps.evaluationCaseId,
    );
    expect(task?.status).toBe("PENDING");
  });

  it("aborts in-flight model calls on shutdown", async () => {
    const deps = await seedExecutionFixture();
    let hangResolve: (() => void) | undefined;
    const hang = new Promise<void>((resolve) => {
      hangResolve = resolve;
    });
    const judgeModel: EvaluationJudgeModelInvoker = {
      generateJudgeCompletion: async (_request, options) => {
        options?.signal?.addEventListener("abort", () => hangResolve?.());
        await hang;
        throw new DOMException("aborted", "AbortError");
      },
    };
    const processor = new ProcessEvaluationJudgeTasks({
      ...deps.baseDeps,
      judgeTasks: deps.judgeTasks,
      judgeModel,
      modelProfiles: deps.modelProfiles,
      executionOwner: "worker-abort",
      leaseTtlMs: DEFAULT_EVALUATION_JUDGE_LEASE_MS,
    });
    const run = processor.execute({ batchLimit: 5 });
    await new Promise((resolve) => setTimeout(resolve, 25));
    processor.abortInFlight();
    await run;
  });

  it("skips judging when parent evaluation run is cancelled", async () => {
    const deps = await seedExecutionFixture();
    const cancelled = deps.evaluationRun.transitionTo("CANCELLED", {
      updatedAt: NOW,
      cancelledAt: NOW,
    });
    await deps.evaluationSuites.transitionEvaluationRun("RUNNING", cancelled);

    const judgeModel: EvaluationJudgeModelInvoker = {
      generateJudgeCompletion: vi.fn(async () => ({
        text: JSON.stringify({
          score: 1,
          reason: "x",
          evidence: ["y"],
        }),
      })),
    };
    const processor = new ProcessEvaluationJudgeTasks({
      ...deps.baseDeps,
      judgeTasks: deps.judgeTasks,
      judgeModel,
      modelProfiles: deps.modelProfiles,
      executionOwner: "worker-cancelled",
    });
    await processor.execute();
    expect(judgeModel.generateJudgeCompletion).not.toHaveBeenCalled();
  });
});

async function seedExecutionFixture() {
  const evaluationSuites = new MemoryEvaluationSuiteRepository();
  const runs = new MemoryRunRepository();
  const agents = new MemoryAgentRepository();
  const queue = new MemoryJobQueue();
  const judgeTasks = new MemoryEvaluationJudgeTaskRepository();
  const modelProfiles = new MapModelProfileRepository();

  const evaluationRunId = "er-judge-exec" as EvaluationRunId;
  const evaluationCaseId = "ec-judge-exec" as EvaluationCaseId;
  const runId = "run-judge-exec" as RunId;
  const runAttemptId = "ra-judge-exec" as RunAttemptId;
  const mpvId = "mpv-judge-exec" as ModelProfileVersionId;

  await modelProfiles.saveModelProfile(
    ModelProfile.create({
      id: "mp-judge-exec" as ModelProfileId,
      workspaceId: WORKSPACE,
      key: "default",
      name: "Default",
      createdAt: NOW,
    }),
  );
  await modelProfiles.saveModelProfileVersion(
    ModelProfileVersion.create({
      id: mpvId,
      modelProfileId: "mp-judge-exec" as ModelProfileId,
      version: 1,
      provider: "OPENAI",
      model: "gpt-4o",
      pricing: {
        currency: "USD",
        inputUsdMicrosPerMillionTokens: 1_000_000,
        outputUsdMicrosPerMillionTokens: 1_000_000,
      },
      createdAt: NOW,
    }),
  );

  const agent = Agent.create({
    id: "agent-judge-exec" as import("@osva-ai/contracts").AgentId,
    workspaceId: WORKSPACE,
    key: "agent",
    name: "Agent",
    createdAt: NOW,
  });
  await agents.saveAgent(agent);
  const agentVersion = AgentVersion.create({
    id: "av-judge-exec" as import("@osva-ai/contracts").AgentVersionId,
    agentId: agent.id,
    version: 1,
    manifest: createManifest(),
    createdAt: NOW,
  });
  await agents.saveAgentVersion(agentVersion);

  const suiteVersion = EvaluationSuiteVersion.create({
    id: "esv-judge-exec" as import("@osva-ai/contracts").EvaluationSuiteVersionId,
    evaluationSuiteId:
      "es-judge-exec" as import("@osva-ai/contracts").EvaluationSuiteId,
    workspaceId: WORKSPACE,
    version: 1,
    cases: [
      EvaluationCase.create({
        id: evaluationCaseId,
        evaluationSuiteVersionId:
          "esv-judge-exec" as import("@osva-ai/contracts").EvaluationSuiteVersionId,
        key: "only",
        input: { prompt: "Q" },
        evaluator: {
          type: "LLM_JUDGE",
          rubric: "Score.",
          modelProfileVersionId: mpvId,
        },
        createdAt: NOW,
      }),
      EvaluationCase.create({
        id: "evaluation-case-malformed" as EvaluationCaseId,
        evaluationSuiteVersionId:
          "esv-judge-exec" as import("@osva-ai/contracts").EvaluationSuiteVersionId,
        key: "bad",
        input: { prompt: "Q2" },
        evaluator: {
          type: "LLM_JUDGE",
          rubric: "Score.",
          modelProfileVersionId: mpvId,
        },
        createdAt: NOW,
      }),
    ],
    createdAt: NOW,
  });
  await evaluationSuites.saveSuiteVersion(suiteVersion);

  const evaluationRun = EvaluationRun.create({
    id: evaluationRunId,
    workspaceId: WORKSPACE,
    evaluationSuiteVersionId: suiteVersion.id,
    targetType: "AGENT_VERSION",
    targetVersionId: agentVersion.id,
    createdAt: NOW,
  });
  await evaluationSuites.saveEvaluationRun(
    evaluationRun.transitionTo("RUNNING", { updatedAt: NOW, startedAt: NOW }),
  );

  const bindings = EffectiveRunBindings.create({
    agentVersionId: agentVersion.id,
    modelProfileVersionBindings: {},
    toolVersionBindings: {},
    memoryNamespaceBindings: {},
    knowledgeIndexBindings: {},
  });
  await runs.saveRun(
    Run.rehydrate({
      id: runId,
      workspaceId: WORKSPACE,
      agentId: agent.id,
      status: "SUCCEEDED",
      effectiveBindings: bindings,
      input: { prompt: "Q" },
      createdAt: NOW,
      updatedAt: NOW,
      evaluationRunId,
      evaluationCaseId,
    }),
  );
  await runs.saveRunAttempt(
    RunAttempt.rehydrate({
      id: runAttemptId,
      runId,
      sequence: 1,
      status: "SUCCEEDED",
      output: "answer",
      createdAt: NOW,
    }),
  );

  const task = EvaluationJudgeTask.create({
    id: "task-pass" as EvaluationJudgeTaskId,
    workspaceId: WORKSPACE,
    evaluationRunId,
    evaluationCaseId,
    runId,
    runAttemptId,
    snapshot: {
      evaluatorConfig: {
        type: "LLM_JUDGE",
        rubric: "Score.",
        modelProfileVersionId: mpvId,
      },
      rubricIdentity: "rubric-1",
      minPassingScore: 0.7,
      maxOutputTokens: 512,
      evaluationSuiteVersionId: suiteVersion.id,
      caseInput: { prompt: "Q" },
    },
    createdAt: NOW,
    maxAttempts: 3,
  });
  await judgeTasks.saveJudgeTaskIfAbsent(task);

  return {
    evaluationSuites,
    judgeTasks,
    modelProfiles,
    evaluationRun,
    evaluationRunId,
    evaluationCaseId,
    baseDeps: {
      evaluationSuites,
      runs,
      agents,
      queue,
      clock: { now: () => NOW },
      ids: { createId: () => `id-${String(Math.random())}` },
    },
    malformedTask: () =>
      EvaluationJudgeTask.create({
        id: "task-malformed" as EvaluationJudgeTaskId,
        workspaceId: WORKSPACE,
        evaluationRunId,
        evaluationCaseId: "evaluation-case-malformed" as EvaluationCaseId,
        runId,
        runAttemptId,
        snapshot: task.snapshot,
        createdAt: NOW,
        maxAttempts: 1,
      }),
  };
}
