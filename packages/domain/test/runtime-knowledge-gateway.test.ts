import type { ExecutionRequest, KnowledgeIndexId } from "@osva/contracts";
import { describe, expect, it, vi } from "vitest";

import { KnowledgeBindingNotFoundError } from "../src/errors.js";
import { KnowledgeRetriever } from "../src/knowledge-retriever.js";
import { RuntimeKnowledgeGateway } from "../src/runtime-knowledge-gateway.js";

const INDEX_A = "ki-index-a" as KnowledgeIndexId;
const INDEX_B = "ki-index-b" as KnowledgeIndexId;

function execution(
  bindings: ExecutionRequest["knowledgeIndexBindings"],
): ExecutionRequest {
  return {
    runId: "run-1" as ExecutionRequest["runId"],
    runAttemptId: "attempt-1" as ExecutionRequest["runAttemptId"],
    workspaceId: "ws-1" as ExecutionRequest["workspaceId"],
    agentId: "agent-1" as ExecutionRequest["agentId"],
    agentVersionId: "av-1" as ExecutionRequest["agentVersionId"],
    runtime: {
      type: "TRUSTED_TYPESCRIPT",
      entrypoint: "agent.ts",
      integrity: "sha256:00",
    },
    input: {},
    effectiveConfig: {},
    modelProfileVersionBindings: {},
    toolVersionBindings: {},
    memoryNamespaceBindings: {},
    knowledgeIndexBindings: bindings,
    toolGrants: [],
    timeoutMs: 30_000,
    policyContext: {},
  };
}

describe("RuntimeKnowledgeGateway", () => {
  it("resolves binding names to frozen index IDs for retrieval", async () => {
    const retrieve = vi.fn(
      async (command: { knowledgeIndexIds: readonly string[] }) => {
        const id = command.knowledgeIndexIds[0];
        return [
          {
            knowledgeChunkId: "chunk-1" as never,
            knowledgeIndexId: id as never,
            knowledgeSourceId: "ks-1" as never,
            artifactReference: {
              type: "artifact",
              artifactId: "art-1" as never,
            },
            text: id === INDEX_A ? "marker-A" : "marker-B",
            score: 1,
            attributes: {},
          },
        ];
      },
    );

    const gateway = new RuntimeKnowledgeGateway({
      retriever: { retrieve } as unknown as KnowledgeRetriever,
    });

    const hitsA = await gateway.search(
      execution({ company_docs: [INDEX_A] }),
      "company_docs",
      { query: "policy" },
    );
    expect(hitsA[0]?.text).toBe("marker-A");
    expect(retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeIndexIds: [INDEX_A] }),
    );

    const hitsB = await gateway.search(
      execution({ company_docs: [INDEX_B] }),
      "company_docs",
      { query: "policy" },
    );
    expect(hitsB[0]?.text).toBe("marker-B");
  });

  it("rejects unknown binding names", async () => {
    const gateway = new RuntimeKnowledgeGateway({
      retriever: {
        retrieve: vi.fn(),
      } as unknown as KnowledgeRetriever,
    });

    await expect(
      gateway.search(execution({}), "company_docs", { query: "x" }),
    ).rejects.toBeInstanceOf(KnowledgeBindingNotFoundError);
  });
});
