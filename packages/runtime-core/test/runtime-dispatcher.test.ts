import type {
  AgentId,
  AgentVersionId,
  ExecutionRequest,
  RunAttemptId,
  RunId,
  RuntimeAdapter,
  WorkspaceId,
} from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { toRuntimeExecutionId } from "../src/execution-id.js";
import { RuntimeDispatcher } from "../src/runtime-dispatcher.js";

const trustedRequest: ExecutionRequest = {
  runId: "run-1" as RunId,
  runAttemptId: "run-attempt-1" as RunAttemptId,
  workspaceId: "ws-1" as WorkspaceId,
  agentId: "agent-1" as AgentId,
  agentVersionId: "agent-version-1" as AgentVersionId,
  runtime: {
    type: "TRUSTED_TYPESCRIPT",
    entrypoint: "echo-agent.ts",
    integrity: `sha256:${"a".repeat(64)}`,
  },
  input: { prompt: "hello" },
  effectiveConfig: {},
  modelProfileVersionBindings: {},
  toolVersionBindings: {},
  memoryNamespaceBindings: {},
  knowledgeIndexBindings: {},
  toolGrants: [],
  timeoutMs: 5_000,
  policyContext: {},
};

function recordingAdapter(label: string, calls: string[]): RuntimeAdapter {
  return {
    async execute(request) {
      calls.push(`${label}:${request.runAttemptId}`);
      return { status: "succeeded", output: { via: label } };
    },
  };
}

describe("RuntimeDispatcher", () => {
  it("selects the executor from the immutable AgentVersion runtime type", async () => {
    const calls: string[] = [];
    const dispatcher = new RuntimeDispatcher({
      executors: {
        TRUSTED_TYPESCRIPT: recordingAdapter("trusted", calls),
        REMOTE_HTTP: recordingAdapter("remote", calls),
      },
    });

    const trusted = await dispatcher.execute(trustedRequest);
    expect(trusted).toEqual({
      status: "succeeded",
      output: { via: "trusted" },
    });
    expect(calls).toEqual(["trusted:run-attempt-1"]);

    const remote = await dispatcher.execute({
      ...trustedRequest,
      runtime: {
        type: "REMOTE_HTTP",
        protocolVersion: "1",
        endpoint: "https://runtime.example.com/execute",
      },
    });
    expect(remote).toEqual({ status: "succeeded", output: { via: "remote" } });
    expect(calls).toEqual(["trusted:run-attempt-1", "remote:run-attempt-1"]);
  });

  it("fails closed when no executor is registered for the runtime type", async () => {
    const dispatcher = new RuntimeDispatcher({ executors: {} });
    const result = await dispatcher.execute(trustedRequest);
    expect(result).toEqual({
      status: "failed",
      error: {
        code: "UNSUPPORTED_RUNTIME",
        message: "No runtime executor is registered for TRUSTED_TYPESCRIPT.",
      },
    });
  });
});

describe("toRuntimeExecutionId", () => {
  it("maps RunAttemptId 1:1 onto executionId", () => {
    expect(toRuntimeExecutionId("run-attempt-1" as RunAttemptId)).toBe(
      "run-attempt-1",
    );
    expect(toRuntimeExecutionId("run-attempt-2" as RunAttemptId)).toBe(
      "run-attempt-2",
    );
  });
});
