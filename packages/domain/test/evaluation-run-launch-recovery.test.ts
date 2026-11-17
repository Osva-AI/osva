import type {
  EvaluationCaseId,
  EvaluationRunId,
  EvaluationSuiteVersionId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { AgentVersion } from "../src/agent-version.js";
import { EvaluationCase } from "../src/evaluation-case.js";
import { EvaluationRun } from "../src/evaluation-run.js";
import { EvaluationSuiteVersion } from "../src/evaluation-suite-version.js";
import type { EvaluationRunApplicationDependencies } from "../src/evaluation-run-application.js";
import {
  ensureEvaluationLaunchMaterialized,
  evaluationCaseIdempotencyKey,
  materializeEvaluationChildRun,
} from "../src/evaluation-run-launch.js";
import { Run } from "../src/run.js";
import { RunAttempt } from "../src/run-attempt.js";
import type { EvaluationSuiteRepository } from "../src/ports/evaluation-suite-repository.js";
import type { RunRepository } from "../src/ports/run-repository.js";
import { agentId, agentVersionId, createManifest } from "./fixtures.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const WORKSPACE = "ws-launch" as WorkspaceId;

class LaunchTestRunRepository implements Pick<
  RunRepository,
  | "createRunWithInitialAttempt"
  | "findRunByWorkspaceIdempotencyKey"
  | "listRunAttempts"
  | "transitionRun"
  | "listRunsByEvaluationRunId"
> {
  readonly runs = new Map<RunId, Run>();
  readonly attempts = new Map<RunAttemptId, RunAttempt>();
  private idempotencyIndex = new Map<string, RunId>();

  async createRunWithInitialAttempt(
    run: Run,
    attempt: RunAttempt,
  ): Promise<void> {
    this.runs.set(run.id, run);
    this.attempts.set(attempt.id, attempt);
    if (run.idempotencyKey !== undefined) {
      this.idempotencyIndex.set(
        `${run.workspaceId}:${run.idempotencyKey}`,
        run.id,
      );
    }
  }

  async findRunByWorkspaceIdempotencyKey(
    workspaceId: WorkspaceId,
    idempotencyKey: string,
  ): Promise<Run | null> {
    const runId = this.idempotencyIndex.get(`${workspaceId}:${idempotencyKey}`);
    if (runId === undefined) {
      return null;
    }
    return this.runs.get(runId) ?? null;
  }

  async listRunAttempts(runId: RunId): Promise<readonly RunAttempt[]> {
    return [...this.attempts.values()].filter(
      (attempt) => attempt.runId === runId,
    );
  }

  async transitionRun(_expectedStatus: Run["status"], next: Run): Promise<Run> {
    this.runs.set(next.id, next);
    return next;
  }

  async listRunsByEvaluationRunId(
    workspaceId: WorkspaceId,
    evaluationRunId: EvaluationRunId,
  ): Promise<readonly Run[]> {
    return [...this.runs.values()].filter(
      (run) =>
        run.workspaceId === workspaceId &&
        run.evaluationRunId === evaluationRunId,
    );
  }
}

class LaunchTestSuiteRepository implements Pick<
  EvaluationSuiteRepository,
  "saveEvaluationRun" | "findEvaluationRunById" | "transitionEvaluationRun"
> {
  readonly runs = new Map<EvaluationRunId, EvaluationRun>();

  async saveEvaluationRun(evaluationRun: EvaluationRun): Promise<void> {
    this.runs.set(evaluationRun.id, evaluationRun);
  }

  async findEvaluationRunById(
    id: EvaluationRunId,
  ): Promise<EvaluationRun | null> {
    return this.runs.get(id) ?? null;
  }

  async transitionEvaluationRun(
    _expectedStatus: EvaluationRun["status"],
    next: EvaluationRun,
  ): Promise<EvaluationRun> {
    this.runs.set(next.id, next);
    return next;
  }
}

function createDeps(
  runs: LaunchTestRunRepository,
  suites: LaunchTestSuiteRepository,
): EvaluationRunApplicationDependencies {
  return {
    evaluationSuites: suites as unknown as EvaluationSuiteRepository,
    runs: runs as unknown as RunRepository,
    agents: {
      findAgentVersionById: async () =>
        AgentVersion.create({
          id: agentVersionId,
          agentId,
          version: 1,
          manifest: createManifest(),
          createdAt: NOW,
        }),
      findAgentByWorkspaceAndId: async () => ({
        id: agentId,
        workspaceId: WORKSPACE,
        key: "agent",
        name: "Agent",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    } as unknown as EvaluationRunApplicationDependencies["agents"],
    queue: {
      enqueue: async () => ({ outcome: "enqueued" as const }),
    } as unknown as EvaluationRunApplicationDependencies["queue"],
    clock: { now: () => NOW },
    ids: {
      createId: (() => {
        let counter = 0;
        return () => `generated-${++counter}`;
      })(),
    },
  };
}

describe("evaluation launch recovery", () => {
  it("reuses existing child runs by idempotency key", async () => {
    const runs = new LaunchTestRunRepository();
    const suites = new LaunchTestSuiteRepository();
    const deps = createDeps(runs, suites);
    const evaluationRunId = "er-1" as EvaluationRunId;
    const evaluationCase = EvaluationCase.create({
      id: "ec-1" as EvaluationCaseId,
      evaluationSuiteVersionId: "esv-1" as EvaluationSuiteVersionId,
      key: "case-a",
      input: "prompt",
      evaluator: { type: "TEXT_EXACT_MATCH", reference: "x" },
      createdAt: NOW,
    });
    const agentVersion =
      (await deps.agents.findAgentVersionById(agentVersionId))!;

    const first = await materializeEvaluationChildRun(deps, {
      workspaceId: WORKSPACE,
      agentVersion,
      evaluationRunId,
      evaluationCase,
      now: NOW,
    });
    const second = await materializeEvaluationChildRun(deps, {
      workspaceId: WORKSPACE,
      agentVersion,
      evaluationRunId,
      evaluationCase,
      now: NOW,
    });

    expect(second).toBe(first);
    expect(
      evaluationCaseIdempotencyKey(evaluationRunId, evaluationCase.id),
    ).toContain("evaluation-run:");
    expect(runs.runs.size).toBe(1);
  });

  it("completes partial launch and transitions parent to RUNNING", async () => {
    const runs = new LaunchTestRunRepository();
    const suites = new LaunchTestSuiteRepository();
    const deps = createDeps(runs, suites);

    const evaluationRun = EvaluationRun.create({
      id: "er-partial" as EvaluationRunId,
      workspaceId: WORKSPACE,
      evaluationSuiteVersionId: "esv-1" as EvaluationSuiteVersionId,
      targetType: "AGENT_VERSION",
      targetVersionId: agentVersionId,
      createdAt: NOW,
    });
    await suites.saveEvaluationRun(evaluationRun);

    const version = EvaluationSuiteVersion.create({
      id: "esv-1" as EvaluationSuiteVersionId,
      evaluationSuiteId:
        "es-1" as import("@osva-ai/contracts").EvaluationSuiteId,
      workspaceId: WORKSPACE,
      version: 1,
      cases: [
        EvaluationCase.create({
          id: "ec-1" as EvaluationCaseId,
          evaluationSuiteVersionId: "esv-1" as EvaluationSuiteVersionId,
          key: "a",
          input: "1",
          evaluator: { type: "TEXT_EXACT_MATCH", reference: "1" },
          createdAt: NOW,
        }),
      ],
      createdAt: NOW,
    });

    await ensureEvaluationLaunchMaterialized(
      deps,
      evaluationRun,
      version,
      agentVersionId,
      NOW,
    );

    const stored = await suites.findEvaluationRunById(evaluationRun.id);
    expect(stored?.status).toBe("RUNNING");
    const childRuns = await runs.listRunsByEvaluationRunId(
      WORKSPACE,
      evaluationRun.id,
    );
    expect(childRuns).toHaveLength(1);
  });
});
