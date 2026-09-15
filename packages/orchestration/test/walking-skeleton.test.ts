import type { ExecutionRequest } from "@osva/contracts";
import {
  FakeRuntimeAdapter,
  MemoryAgentRepository,
  MemoryJobQueue,
  MemoryRunRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import { describe, expect, it } from "vitest";

import { CreateRun } from "../src/create-run.js";
import { ExecuteRunAttempt } from "../src/execute-run-attempt.js";
import {
  LATER,
  NOW,
  RUN_INPUT,
  agentVersionId,
  runAttemptId,
  runId,
  seedAgentGraph,
  workspaceId,
  agentId,
} from "./fixtures.js";

describe("in-process walking skeleton", () => {
  it("creates a Run, enqueues only runAttemptId, reconstructs ExecutionRequest, and succeeds", async () => {
    const workspaces = new MemoryWorkspaceRepository();
    const agents = new MemoryAgentRepository();
    const runs = new MemoryRunRepository();
    const queue = new MemoryJobQueue();
    const received: ExecutionRequest[] = [];

    await seedAgentGraph(workspaces, agents, { timeoutMs: 12_345 });

    const createRun = new CreateRun({ runs, agents, queue });
    const executeRunAttempt = new ExecuteRunAttempt({
      runs,
      agents,
      runtime: new FakeRuntimeAdapter(async (request) => {
        received.push(request);
        return { status: "succeeded", output: { ok: true } };
      }),
    });

    const created = await createRun.execute({
      runId,
      runAttemptId,
      workspaceId,
      agentId,
      agentVersionId,
      input: RUN_INPUT,
      now: NOW,
    });

    expect(created.run.status).toBe("QUEUED");
    expect(created.runAttempt.status).toBe("PENDING");
    expect(created.runAttempt.sequence).toBe(1);
    expect(created.run.input).toEqual(RUN_INPUT);
    expect(queue.pendingRunAttemptIds()).toEqual([runAttemptId]);

    const persistedAttempt = await runs.findRunAttemptById(runAttemptId);
    expect(persistedAttempt?.id).toBe(runAttemptId);
    expect(persistedAttempt?.runId).toBe(runId);

    await queue.consume(async (payload) => {
      expect(payload).toEqual({ runAttemptId });
      expect(Object.keys(payload)).toEqual(["runAttemptId"]);

      const queued = await runs.findRunById(runId);
      expect(queued?.status).toBe("QUEUED");

      const result = await executeRunAttempt.execute({
        runAttemptId: payload.runAttemptId,
        now: LATER,
      });

      expect(result.outcome).toBe("succeeded");
      if (result.outcome !== "succeeded") {
        return;
      }

      const runningWasObserved = received.length === 1;
      expect(runningWasObserved).toBe(true);
    });

    expect(received).toHaveLength(1);
    const request = received[0];
    if (request === undefined) {
      throw new Error("expected reconstructed ExecutionRequest");
    }
    expect(request).toMatchObject({
      runId,
      runAttemptId,
      agentVersionId,
      input: RUN_INPUT,
      effectiveConfig: {},
      toolGrants: [],
      timeoutMs: 12_345,
      policyContext: {},
      modelProfileVersionBindings: {},
    });
    expect(Object.isFrozen(request)).toBe(true);

    const finishedRun = await runs.findRunById(runId);
    const finishedAttempt = await runs.findRunAttemptById(runAttemptId);
    expect(finishedRun?.status).toBe("SUCCEEDED");
    expect(finishedAttempt?.status).toBe("SUCCEEDED");
    expect(finishedRun?.input).toEqual(RUN_INPUT);
    expect(queue.pendingRunAttemptIds()).toEqual([]);
  });
});
