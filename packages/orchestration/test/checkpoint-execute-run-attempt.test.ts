import type { ExecutionRequest } from "@osva-ai/contracts";
import { DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION } from "@osva-ai/contracts";
import {
  FakeRuntimeAdapter,
  MemoryAgentRepository,
  MemoryJobQueue,
  MemoryRunCheckpointRepository,
  MemoryRunRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import { Agent, AgentVersion, Workspace } from "@osva/domain";
import { describe, expect, it } from "vitest";

import { CreateRun } from "../src/create-run.js";
import { ExecuteRunAttempt } from "../src/execute-run-attempt.js";
import {
  agentId,
  agentVersionId,
  createBindings,
  createManifest,
  LATER,
  modelProfileVersionId,
  NOW,
  RUN_INPUT,
  runAttemptId,
  runId,
  seedAgentGraph,
  workspaceId,
} from "./fixtures.js";

describe("ExecuteRunAttempt checkpoint binding", () => {
  it("passes restore state from the latest checkpoint to the runtime", async () => {
    const workspaces = new MemoryWorkspaceRepository();
    const agents = new MemoryAgentRepository();
    const runs = new MemoryRunRepository();
    const checkpoints = new MemoryRunCheckpointRepository();
    const queue = new MemoryJobQueue();
    runs.clock = { now: () => LATER };

    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );
    await agents.saveAgent(
      Agent.create({
        id: agentId,
        workspaceId,
        key: "agent-key-1",
        name: "Example Agent",
        createdAt: NOW,
      }),
    );
    await agents.saveAgentVersion(
      AgentVersion.create({
        id: agentVersionId,
        agentId,
        version: 1,
        manifest: {
          ...createManifest({
            capabilities: { model: true, tools: [] },
            models: {
              default: { modelProfileVersionId },
            },
          }),
          runtime: {
            type: "DECLARATIVE",
            config: {
              configVersion: "1",
              instructions: "test",
              modelBinding: "default",
              allowedToolBindings: [],
              maxModelInvocations: 2,
              maxToolInvocations: 0,
              checkpointingEnabled: true,
            },
          },
        },
        createdAt: NOW,
      }),
    );

    const createRun = new CreateRun({ runs, agents, queue });
    await createRun.execute({
      runId,
      runAttemptId,
      workspaceId,
      agentId,
      agentVersionId,
      input: RUN_INPUT,
      now: NOW,
    });

    const bindings = createBindings();
    checkpoints.trackRunningAttempt({
      runAttemptId,
      owner: "worker-test",
      generation: 1,
    });
    await checkpoints.commit({
      workspaceId,
      runId,
      runAttemptId,
      executionGeneration: 1,
      executionOwner: "worker-test",
      runtimeKind: "DECLARATIVE",
      bindingIdentity: {
        agentVersionId,
        modelProfileVersionBindings: bindings.modelProfileVersionBindings,
        toolVersionBindings: bindings.toolVersionBindings,
      },
      cursor: { phase: "after_prefetch", checkpointSequence: 1 },
      state: {
        schemaVersion: DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION,
        messages: [{ role: "system", content: "saved-history" }],
        modelInvocations: 0,
        toolInvocations: 0,
      },
      idempotencyKey: "prefetch-1",
    });

    let captured: ExecutionRequest | undefined;
    const executeRunAttempt = new ExecuteRunAttempt({
      runs,
      agents,
      checkpoints,
      runtime: new FakeRuntimeAdapter(async (request) => {
        captured = request;
        return { status: "succeeded", output: { ok: true } };
      }),
      executionOwner: "worker-test",
    });

    await executeRunAttempt.execute({ runAttemptId, now: LATER });

    expect(captured?.checkpoint?.restore?.messages[0]?.content).toBe(
      "saved-history",
    );
  });

  it("does not attach checkpoint binding when checkpointing is disabled", async () => {
    const workspaces = new MemoryWorkspaceRepository();
    const agents = new MemoryAgentRepository();
    const runs = new MemoryRunRepository();
    const checkpoints = new MemoryRunCheckpointRepository();
    const queue = new MemoryJobQueue();
    runs.clock = { now: () => LATER };
    await seedAgentGraph(workspaces, agents);

    const createRun = new CreateRun({ runs, agents, queue });
    await createRun.execute({
      runId,
      runAttemptId,
      workspaceId,
      agentId,
      agentVersionId,
      input: RUN_INPUT,
      now: NOW,
    });

    let captured: ExecutionRequest | undefined;
    const executeRunAttempt = new ExecuteRunAttempt({
      runs,
      agents,
      checkpoints,
      runtime: new FakeRuntimeAdapter(async (request) => {
        captured = request;
        return { status: "succeeded", output: { ok: true } };
      }),
      executionOwner: "worker-test",
    });

    const result = await executeRunAttempt.execute({
      runAttemptId,
      now: LATER,
    });
    expect(result.outcome).toBe("succeeded");
    expect(captured?.checkpoint).toBeUndefined();
  });
});
