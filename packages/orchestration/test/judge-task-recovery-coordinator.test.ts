import { MemoryEvaluationJudgeTaskRepository } from "@osva/adapters-memory";
import { describe, expect, it } from "vitest";

import { EvaluationRecoveryTick } from "../src/evaluation-recovery-tick.js";
import { JudgeTaskRecoveryCoordinator } from "../src/judge-task-recovery-coordinator.js";

describe("JudgeTaskRecoveryCoordinator", () => {
  it("does not block evaluation recovery while judge batch is in flight", async () => {
    let judgeStarted = false;
    let judgeRelease: (() => void) | undefined;
    const judgeGate = new Promise<void>((resolve) => {
      judgeRelease = resolve;
    });

    const coordinator = new JudgeTaskRecoveryCoordinator({
      batchLimit: 1,
      processor: {
        execute: async () => {
          judgeStarted = true;
          await judgeGate;
          return 1;
        },
      },
    });

    let evaluationRan = false;
    const tick = new EvaluationRecoveryTick({
      evaluationSuites: {
        listEvaluationRunsForRecovery: async () => {
          evaluationRan = true;
          return [];
        },
        listTerminalEvaluationRunsMissingGateAssessment: async () => [],
      } as never,
      runs: {} as never,
      agents: {} as never,
      queue: {
        enqueue: async () => ({ outcome: "enqueued" as const }),
        cancel: async () => {},
        consume: async () => {},
        shutdown: async () => {},
      },
      clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
      ids: { createId: () => "id" },
      judgeTasks: new MemoryEvaluationJudgeTaskRepository(),
      reconcileEvaluationCase: { execute: async () => {} },
      judgeTaskCoordinator: coordinator,
    });

    await tick.execute();
    expect(evaluationRan).toBe(true);
    expect(judgeStarted).toBe(true);

    judgeRelease?.();
    await coordinator.drain();
  });

  it("limits concurrent judge batches to one in-flight execution", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const coordinator = new JudgeTaskRecoveryCoordinator({
      batchLimit: 1,
      processor: {
        execute: async () => {
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((resolve) => setTimeout(resolve, 50));
          concurrent -= 1;
          return 1;
        },
      },
    });
    coordinator.schedule();
    coordinator.schedule();
    await coordinator.drain();
    expect(maxConcurrent).toBe(1);
  });

  it("drain aborts in-flight judge work before awaiting the batch", async () => {
    let aborted = false;
    const coordinator = new JudgeTaskRecoveryCoordinator({
      batchLimit: 1,
      processor: {
        execute: async () => {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 200);
          });
          return 1;
        },
        abortInFlight: () => {
          aborted = true;
        },
      },
    });
    coordinator.schedule();
    await coordinator.drain();
    expect(aborted).toBe(true);
  });
});
