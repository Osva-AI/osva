import { resolveJsonPointer } from "@osva-ai/contracts";
import { assertWorkflowDefinition, buildWorkflowGraph } from "@osva/domain";
import { describe, expect, it } from "vitest";

import { validAnalysisOutput } from "./fixtures.js";
import { materializeReferenceWorkflowDefinition } from "./materialize-workflow.js";

const expectedSequence = [
  "research",
  "analysis",
  "adoption-approval",
  "delivery-wait",
  "report",
] as const;

function linearNodeKeys(
  fromEntry: string,
  outgoing: Map<string, readonly string[]>,
): string[] {
  const keys: string[] = [];
  let current: string | undefined = fromEntry;
  while (current !== undefined) {
    keys.push(current);
    const next: string | undefined = outgoing.get(current)?.[0];
    current = next;
  }
  return keys;
}

describe("dependency-adoption reference workflow graph", () => {
  it("materializes placeholder AgentVersion IDs and passes OSVA V3 validation", () => {
    const definition = materializeReferenceWorkflowDefinition();

    expect(definition.schemaVersion).toBe("3");
    expect(() => assertWorkflowDefinition(definition)).not.toThrow();

    const graph = buildWorkflowGraph(definition);
    expect(definition.nodes).toHaveLength(5);

    const typeCounts = definition.nodes.reduce<Record<string, number>>(
      (acc, node) => {
        acc[node.type] = (acc[node.type] ?? 0) + 1;
        return acc;
      },
      {},
    );

    expect(typeCounts.AGENT).toBe(3);
    expect(typeCounts.APPROVAL).toBe(1);
    expect(typeCounts.WAIT).toBe(1);

    const outgoing = new Map<string, readonly string[]>();
    for (const [key, edges] of graph.outgoing.entries()) {
      outgoing.set(key, edges);
    }
    expect(linearNodeKeys(graph.entryKey, outgoing)).toEqual([
      ...expectedSequence,
    ]);

    const waitNode = definition.nodes.find(
      (node) => node.key === "delivery-wait",
    );
    expect(waitNode?.type).toBe("WAIT");
    if (waitNode?.type !== "WAIT") {
      throw new Error("Expected delivery-wait WAIT node.");
    }

    expect(waitNode.wait).toEqual({
      kind: "EVENT",
      source: "canonical-demo",
      eventType: "report.delivery_requested",
      correlation: {
        kind: "INPUT_POINTER",
        pointer: "/request/requestId",
      },
      timeoutMs: 900_000,
    });
  });

  it("resolves /request/requestId from representative analysis output", () => {
    const resolved = resolveJsonPointer(
      validAnalysisOutput,
      "/request/requestId",
    );
    expect(resolved).toEqual({
      found: true,
      value: validAnalysisOutput.request.requestId,
    });
  });
});
