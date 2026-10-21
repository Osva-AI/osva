import type {
  EvaluationCaseId,
  EvaluationRunId,
  ExecutionRequest,
} from "@osva-ai/contracts";
import { describe, expect, it, vi } from "vitest";

import { buildDeclarativeContextUserContent } from "../src/declarative-context-prefetch.js";
import { DeclarativeRuntimeErrorCode } from "../src/constants.js";

function baseExecution(
  overrides: Partial<ExecutionRequest> = {},
): ExecutionRequest {
  return {
    runId: "run-1" as ExecutionRequest["runId"],
    runAttemptId: "attempt-1" as ExecutionRequest["runAttemptId"],
    workspaceId: "ws-1" as ExecutionRequest["workspaceId"],
    agentId: "agent-1" as ExecutionRequest["agentId"],
    agentVersionId: "av-1" as ExecutionRequest["agentVersionId"],
    runtime: {
      type: "DECLARATIVE",
      config: {
        configVersion: "1",
        instructions: "x",
        modelBinding: "primary",
        allowedToolBindings: [],
        maxModelInvocations: 1,
        maxToolInvocations: 0,
      },
    },
    input: { task: "hello" },
    effectiveConfig: {},
    modelProfileVersionBindings: {},
    toolVersionBindings: {},
    memoryNamespaceBindings: {},
    knowledgeIndexBindings: {},
    toolGrants: [],
    timeoutMs: 5_000,
    policyContext: {},
    ...overrides,
  };
}

describe("buildDeclarativeContextUserContent", () => {
  it("returns undefined when no context bindings exist", async () => {
    const result = await buildDeclarativeContextUserContent({
      request: baseExecution(),
      knowledgeGateway: undefined,
      memoryGateway: undefined,
    });
    expect(result).toBeUndefined();
  });

  it("lists memory records for read-only bindings", async () => {
    const list = vi.fn(async () => ({
      items: [{ key: "greeting", value: { text: "hi" }, revision: 1 }],
    }));

    const result = await buildDeclarativeContextUserContent({
      request: baseExecution({
        memoryNamespaceBindings: {
          notes: {
            namespaceId: "mn-1" as never,
            access: "READ_ONLY",
          },
        },
      }),
      knowledgeGateway: undefined,
      memoryGateway: { list },
    });

    expect(list).toHaveBeenCalled();
    expect(result).toContain("greeting");
    expect(result).toContain("untrusted retrieved data");
  });

  it("passes allowPersistentMutation false to memory list authorization", async () => {
    const list = vi.fn(async (_request, authorization) => {
      expect(authorization.allowPersistentMutation).toBe(false);
      return { items: [] };
    });

    await buildDeclarativeContextUserContent({
      request: baseExecution({
        evaluationContext: {
          evaluationRunId: "eval-run-1" as EvaluationRunId,
          evaluationCaseId: "eval-case-1" as EvaluationCaseId,
        },
        memoryNamespaceBindings: {
          notes: {
            namespaceId: "mn-1" as never,
            access: "READ_WRITE",
          },
        },
      }),
      knowledgeGateway: undefined,
      memoryGateway: { list },
    });

    expect(list).toHaveBeenCalled();
  });

  it("passes allowPersistentMutation false when restrictPersistentMemory is set on the execution request", async () => {
    const list = vi.fn(async (_request, authorization) => {
      expect(authorization.allowPersistentMutation).toBe(false);
      return { items: [] };
    });

    await buildDeclarativeContextUserContent({
      request: baseExecution({
        restrictPersistentMemory: true,
        memoryNamespaceBindings: {
          notes: {
            namespaceId: "mn-1" as never,
            access: "READ_WRITE",
          },
        },
      }),
      knowledgeGateway: undefined,
      memoryGateway: { list },
    });

    expect(list).toHaveBeenCalled();
  });

  it("does not invoke memory set through prefetch for READ_WRITE bindings", async () => {
    const list = vi.fn(async () => ({
      items: [{ key: "k", value: { ok: true }, revision: 1 }],
    }));
    const memoryGateway = {
      list,
      set: vi.fn(),
    };

    await buildDeclarativeContextUserContent({
      request: baseExecution({
        memoryNamespaceBindings: {
          notes: {
            namespaceId: "mn-1" as never,
            access: "READ_WRITE",
          },
        },
      }),
      knowledgeGateway: undefined,
      memoryGateway,
    });

    expect(memoryGateway.set).not.toHaveBeenCalled();
  });

  it("fails memory prefetch when list is denied", async () => {
    const list = vi.fn(async () => {
      const error = new Error("Memory permission denied.");
      (error as { code?: string }).code = "MEMORY_PERMISSION_DENIED";
      throw error;
    });

    await expect(
      buildDeclarativeContextUserContent({
        request: baseExecution({
          memoryNamespaceBindings: {
            notes: {
              namespaceId: "mn-1" as never,
              access: "READ_ONLY",
            },
          },
        }),
        knowledgeGateway: undefined,
        memoryGateway: { list },
      }),
    ).rejects.toMatchObject({
      code: DeclarativeRuntimeErrorCode.MEMORY_UNAVAILABLE,
    });
  });

  it("fails when knowledge gateway is missing but bindings exist", async () => {
    await expect(
      buildDeclarativeContextUserContent({
        request: baseExecution({
          knowledgeIndexBindings: { docs: ["ki-1" as never] },
        }),
        knowledgeGateway: undefined,
        memoryGateway: undefined,
      }),
    ).rejects.toMatchObject({
      code: DeclarativeRuntimeErrorCode.KNOWLEDGE_UNAVAILABLE,
    });
  });
});
