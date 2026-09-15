import type {
  AgentId,
  AgentVersionId,
  ModelProfileVersionId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva/contracts";
import {
  AgentVersion,
  DomainInvariantError,
  EffectiveRunBindings,
  Run,
  RunAttempt,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { createExecutionRequest } from "../src/create-execution-request.js";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const workspaceId = "ws-1" as WorkspaceId;
const agentId = "agent-1" as AgentId;
const otherAgentId = "agent-2" as AgentId;
const agentVersionId = "agent-version-1" as AgentVersionId;
const otherAgentVersionId = "agent-version-2" as AgentVersionId;
const runId = "run-1" as RunId;
const otherRunId = "run-2" as RunId;
const runAttemptId = "run-attempt-1" as RunAttemptId;
const modelProfileVersionId =
  "model-profile-version-1" as ModelProfileVersionId;
const secondaryModelProfileVersionId =
  "model-profile-version-2" as ModelProfileVersionId;
const RUN_INPUT = { prompt: "reconstruct me" };

function createBindings(
  versionId: AgentVersionId = agentVersionId,
): EffectiveRunBindings {
  return EffectiveRunBindings.create({
    agentVersionId: versionId,
    modelProfileVersionBindings: {
      default: modelProfileVersionId,
      "tool.summarize": secondaryModelProfileVersionId,
    },
  });
}

function createVersion(
  id: AgentVersionId = agentVersionId,
  owner: AgentId = agentId,
  timeoutMs = 45_000,
): AgentVersion {
  return AgentVersion.create({
    id,
    agentId: owner,
    version: 1,
    manifest: {
      schemaVersion: "1",
      key: "example-agent",
      name: "Example Agent",
      runtime: { type: "BUILTIN_PACKAGE", key: "example-agent" },
      input: { schema: {} },
      output: { schema: {} },
      execution: { timeoutMs, maxAttempts: 2 },
      capabilities: { model: false, tools: [] },
    },
    createdAt: NOW,
  });
}

function createRun(): Run {
  return Run.create({
    id: runId,
    workspaceId,
    agentId,
    effectiveBindings: createBindings(),
    input: RUN_INPUT,
    createdAt: NOW,
  });
}

function createAttempt(attemptRunId: RunId = runId): RunAttempt {
  return RunAttempt.createFirst({
    id: runAttemptId,
    runId: attemptRunId,
    createdAt: NOW,
  });
}

describe("createExecutionRequest", () => {
  it("reconstructs identities, input, bindings, and timeout from immutable state", () => {
    const run = createRun();
    const request = createExecutionRequest({
      run,
      runAttempt: createAttempt(),
      agentVersion: createVersion(agentVersionId, agentId, 45_000),
    });

    expect(request).toEqual({
      runId,
      runAttemptId,
      agentVersionId,
      input: RUN_INPUT,
      effectiveConfig: {},
      modelProfileVersionBindings:
        run.effectiveBindings.modelProfileVersionBindings,
      toolGrants: [],
      timeoutMs: 45_000,
      policyContext: {},
    });
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.effectiveConfig)).toBe(true);
    expect(Object.isFrozen(request.toolGrants)).toBe(true);
    expect(Object.isFrozen(request.policyContext)).toBe(true);
  });

  it("rejects a RunAttempt that does not belong to the Run", () => {
    expect(() =>
      createExecutionRequest({
        run: createRun(),
        runAttempt: createAttempt(otherRunId),
        agentVersion: createVersion(),
      }),
    ).toThrow(DomainInvariantError);
  });

  it("rejects an AgentVersion that does not match effective bindings", () => {
    expect(() =>
      createExecutionRequest({
        run: createRun(),
        runAttempt: createAttempt(),
        agentVersion: createVersion(otherAgentVersionId),
      }),
    ).toThrow(DomainInvariantError);
  });

  it("rejects an AgentVersion owned by a different Agent", () => {
    expect(() =>
      createExecutionRequest({
        run: createRun(),
        runAttempt: createAttempt(),
        agentVersion: createVersion(agentVersionId, otherAgentId),
      }),
    ).toThrow(DomainInvariantError);
  });
});
