import type { ExecutionRequest } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { resolveModelGatewayGenerateOptions } from "../src/model-gateway-cache-context.js";

const baseExecution = {
  workspaceId: "ws-1" as ExecutionRequest["workspaceId"],
} as ExecutionRequest;

describe("resolveModelGatewayGenerateOptions", () => {
  it("does not enable cache without a server-trusted policy object", () => {
    const execution = {
      ...baseExecution,
      policyContext: {
        inferenceResponseCache: { enabled: true, evil: true },
      },
    } as ExecutionRequest;

    expect(resolveModelGatewayGenerateOptions(execution)).toBeUndefined();
  });

  it("does not enable cache for evaluation judge executions", () => {
    const execution = {
      ...baseExecution,
      evaluationContext: {
        evaluationRunId: "er-1" as import("@osva-ai/contracts").EvaluationRunId,
        evaluationCaseId:
          "ec-1" as import("@osva-ai/contracts").EvaluationCaseId,
      },
      policyContext: {
        inferenceResponseCache: {
          schemaVersion: "1",
          enabled: true,
          determinism: "REQUIRED_DETERMINISTIC",
        },
      },
    } as ExecutionRequest;

    const options = resolveModelGatewayGenerateOptions(execution);
    expect(options?.cache?.executionPurpose).toBe("EVALUATION_JUDGE");
  });

  it("passes cache context when policy validates", () => {
    const execution = {
      ...baseExecution,
      policyContext: {
        inferenceResponseCache: {
          schemaVersion: "1",
          enabled: true,
          determinism: "REQUIRED_DETERMINISTIC",
        },
      },
    } as ExecutionRequest;

    const options = resolveModelGatewayGenerateOptions(execution);
    expect(options?.cache).toMatchObject({
      workspaceId: "ws-1",
      executionPurpose: "AGENT_RUN",
    });
  });
});
