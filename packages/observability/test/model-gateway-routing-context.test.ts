import type { ExecutionRequest } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { resolveModelGatewayRoutingContext } from "../src/model-gateway-routing-context.js";

function execution(
  policyContext: ExecutionRequest["policyContext"],
  evaluationContext?: ExecutionRequest["evaluationContext"],
): ExecutionRequest {
  return {
    runId: "run-1" as import("@osva-ai/contracts").RunId,
    runAttemptId: "ra-1" as import("@osva-ai/contracts").RunAttemptId,
    workspaceId: "ws-1" as import("@osva-ai/contracts").WorkspaceId,
    agentId: "agent-1" as import("@osva-ai/contracts").AgentId,
    agentVersionId: "av-1" as import("@osva-ai/contracts").AgentVersionId,
    timeoutMs: 30_000,
    input: {},
    effectiveConfig: {},
    runtime: {
      type: "TRUSTED_TYPESCRIPT",
      entrypoint: "agent.ts",
      integrity: "sha256:00",
    },
    modelProfileVersionBindings: {},
    toolVersionBindings: {},
    memoryNamespaceBindings: {},
    knowledgeIndexBindings: {},
    toolGrants: [],
    policyContext,
    ...(evaluationContext !== undefined ? { evaluationContext } : {}),
  };
}

describe("resolveModelGatewayRoutingContext", () => {
  it("omits routing for evaluation judge execution", () => {
    const boundModelProfileVersionId =
      "mpv-bind" as import("@osva-ai/contracts").ModelProfileVersionId;

    const result = resolveModelGatewayRoutingContext(
      execution(
        {
          inferenceRouting: {
            schemaVersion: "1",
            enabled: true,
            policyVersionId:
              "irpv-1" as import("@osva-ai/contracts").InferenceRoutingPolicyVersionId,
            definition: {
              schemaVersion: "1",
              strategy: "FIXED",
              candidateModelProfileVersionIds: [
                "mpv-1" as import("@osva-ai/contracts").ModelProfileVersionId,
              ],
            },
          },
        },
        {
          evaluationRunId:
            "er-1" as import("@osva-ai/contracts").EvaluationRunId,
          evaluationCaseId:
            "ec-1" as import("@osva-ai/contracts").EvaluationCaseId,
        },
      ),
      boundModelProfileVersionId,
    );
    expect(result?.routing).toBeUndefined();
  });
});
