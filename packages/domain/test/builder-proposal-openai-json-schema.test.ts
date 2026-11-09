import type { AgentVersionId } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import type { BuilderProposalV1 } from "../src/builder/builder-proposal.js";

import {
  BuilderProposalOpenAiJsonSchema,
  builderProposalOpenAiJsonSchemaFragments,
} from "../src/builder/builder-proposal-openai-json-schema.js";
import {
  collectOpenAiStrictViolations,
  countUntypedConstNodes,
} from "../src/builder/builder-proposal-openai-json-schema-strict.js";
import {
  normalizeOpenAiStructuredProposalNulls,
  parseBuilderProposalV1,
} from "../src/builder/builder-proposal-schema.js";
import { baseProposal } from "./builder-natural-language-test-helpers.js";

function withNullableExecution(
  proposal: ReturnType<typeof baseProposal>,
): unknown {
  const agent = proposal.agents[0];
  if (agent === undefined || agent.kind !== "NEW") {
    return proposal;
  }

  return {
    ...proposal,
    workflowRegistry: {
      ...proposal.workflowRegistry,
      description: null,
    },
    agents: [
      {
        ...agent,
        execution: {
          ...agent.execution,
          maxOutputTokens: null,
          checkpointingEnabled: null,
          automaticRecoveryEnabled: null,
        },
      },
    ],
  };
}

function cloneSchema(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(BuilderProposalOpenAiJsonSchema)) as Record<
    string,
    unknown
  >;
}

describe("BuilderProposalOpenAiJsonSchema", () => {
  it("matches the exact Chat Completions response_format.json_schema payload", () => {
    const envelope = {
      type: "json_schema" as const,
      json_schema: {
        name: "agent_output",
        schema: BuilderProposalOpenAiJsonSchema,
        strict: true,
      },
    };
    expect(envelope.json_schema.strict).toBe(true);
    expect(JSON.parse(JSON.stringify(envelope.json_schema.schema))).toEqual(
      BuilderProposalOpenAiJsonSchema,
    );
    expect(
      (
        envelope.json_schema.schema as {
          properties: { agents: { items: unknown } };
        }
      ).properties.agents.items,
    ).toHaveProperty("anyOf");
  });

  it("preserves meaningful BRANCH case equals null through normalization", () => {
    const raw = {
      ...(withNullableExecution(baseProposal()) as Record<string, unknown>),
      workflow: {
        nodes: [
          {
            key: "branch",
            type: "BRANCH",
            selector: "/flag",
            cases: [{ equals: null, to: "when-null" }],
            defaultTo: "otherwise",
          },
        ],
        edges: [],
      },
    };
    const normalized = normalizeOpenAiStructuredProposalNulls(raw);
    const branchNode = (
      normalized as { workflow: { nodes: Array<Record<string, unknown>> } }
    ).workflow.nodes[0];
    const equals = (
      branchNode?.cases as Array<{ equals: unknown }> | undefined
    )?.[0]?.equals;
    expect(equals).toBeNull();
    expect(parseBuilderProposalV1(raw).ok).toBe(true);
  });

  it("satisfies OpenAI strict json_schema invariants on every nested object", () => {
    expect(countUntypedConstNodes(BuilderProposalOpenAiJsonSchema)).toBe(0);

    const violations = collectOpenAiStrictViolations(
      BuilderProposalOpenAiJsonSchema,
    );
    expect(violations).toEqual([]);

    for (const fragment of Object.values(
      builderProposalOpenAiJsonSchemaFragments,
    )) {
      expect(countUntypedConstNodes(fragment)).toBe(0);
      expect(collectOpenAiStrictViolations(fragment)).toEqual([]);
    }
  });

  it("rejects the confirmed production defect (agents NEW kind without type)", () => {
    const mutated = cloneSchema();
    const agents = mutated.properties as Record<string, unknown>;
    const items = (agents.agents as Record<string, unknown>).items as Record<
      string,
      unknown
    >;
    const newAgent = (items.anyOf as unknown[])[0] as Record<string, unknown>;
    const kind = (newAgent.properties as Record<string, unknown>)
      .kind as Record<string, unknown>;
    delete kind.type;

    const violations = collectOpenAiStrictViolations(mutated);
    expect(violations).toContain(
      "$.properties.agents.items.anyOf[0].properties.kind: const subschema must declare explicit 'type'",
    );
  });

  const untypedConstMutationTargets = [
    {
      label: "NEW agent kind",
      path: ["agents", "items", "anyOf", 0, "properties", "kind"],
    },
    {
      label: "EXISTING agent kind",
      path: ["agents", "items", "anyOf", 1, "properties", "kind"],
    },
    {
      label: "inputSchema type const",
      path: [
        "agents",
        "items",
        "anyOf",
        0,
        "properties",
        "inputSchema",
        "properties",
        "type",
      ],
    },
    {
      label: "AGENT node type",
      path: [
        "workflow",
        "properties",
        "nodes",
        "items",
        "anyOf",
        0,
        "properties",
        "type",
      ],
    },
    {
      label: "BRANCH node type",
      path: [
        "workflow",
        "properties",
        "nodes",
        "items",
        "anyOf",
        1,
        "properties",
        "type",
      ],
    },
    {
      label: "PARALLEL node type",
      path: [
        "workflow",
        "properties",
        "nodes",
        "items",
        "anyOf",
        2,
        "properties",
        "type",
      ],
    },
    {
      label: "JOIN node type",
      path: [
        "workflow",
        "properties",
        "nodes",
        "items",
        "anyOf",
        3,
        "properties",
        "type",
      ],
    },
    {
      label: "APPROVAL node type",
      path: [
        "workflow",
        "properties",
        "nodes",
        "items",
        "anyOf",
        4,
        "properties",
        "type",
      ],
    },
    {
      label: "WAIT node type",
      path: [
        "workflow",
        "properties",
        "nodes",
        "items",
        "anyOf",
        5,
        "properties",
        "type",
      ],
    },
    {
      label: "WAIT DURATION kind",
      path: [
        "workflow",
        "properties",
        "nodes",
        "items",
        "anyOf",
        5,
        "properties",
        "wait",
        "anyOf",
        0,
        "properties",
        "kind",
      ],
    },
    {
      label: "WAIT UNTIL kind",
      path: [
        "workflow",
        "properties",
        "nodes",
        "items",
        "anyOf",
        5,
        "properties",
        "wait",
        "anyOf",
        1,
        "properties",
        "kind",
      ],
    },
    {
      label: "WAIT EVENT kind",
      path: [
        "workflow",
        "properties",
        "nodes",
        "items",
        "anyOf",
        5,
        "properties",
        "wait",
        "anyOf",
        2,
        "properties",
        "kind",
      ],
    },
    {
      label: "correlation LITERAL kind",
      path: [
        "workflow",
        "properties",
        "nodes",
        "items",
        "anyOf",
        5,
        "properties",
        "wait",
        "anyOf",
        2,
        "properties",
        "correlation",
        "anyOf",
        0,
        "properties",
        "kind",
      ],
    },
    {
      label: "correlation INPUT_POINTER kind",
      path: [
        "workflow",
        "properties",
        "nodes",
        "items",
        "anyOf",
        5,
        "properties",
        "wait",
        "anyOf",
        2,
        "properties",
        "correlation",
        "anyOf",
        1,
        "properties",
        "kind",
      ],
    },
  ] as const;

  it.each(untypedConstMutationTargets.map((t) => [t.label, t.path] as const))(
    "lint rejects untyped const at %s",
    (_label, path) => {
      const mutated = cloneSchema();
      let cursor: unknown = mutated.properties;
      for (let i = 0; i < path.length; i += 1) {
        const segment = path[i];
        if (cursor === null || typeof cursor !== "object") {
          throw new Error("invalid mutation path");
        }
        const record = cursor as Record<string, unknown>;
        if (i === path.length - 1) {
          const leaf = record[segment as string] as Record<string, unknown>;
          delete leaf.type;
        } else {
          cursor = record[segment as string];
        }
      }

      const violations = collectOpenAiStrictViolations(mutated);
      expect(violations.length).toBeGreaterThan(0);
      expect(
        violations.some((v) => v.includes("const subschema must declare")),
      ).toBe(true);
    },
  );

  it("accepts a minimal NEW-agent proposal shape compatible with downstream parse", () => {
    const raw = withNullableExecution(baseProposal());
    expect(parseBuilderProposalV1(raw).ok).toBe(true);
  });

  it("covers EXISTING agent spec", () => {
    const raw = withNullableExecution({
      ...baseProposal(),
      agents: [
        {
          kind: "EXISTING",
          ref: "bpr_cat",
          agentVersionId: "agv_existing" as AgentVersionId,
        },
      ],
      workflow: {
        nodes: [{ key: "n1", type: "AGENT", agentRef: "bpr_cat" }],
        edges: [],
      },
    });
    expect(parseBuilderProposalV1(raw).ok).toBe(true);
  });

  const nodeVariants = [
    { key: "n_agent", type: "AGENT", agentRef: "bpr_a" },
    {
      key: "n_branch",
      type: "BRANCH",
      selector: "/x",
      cases: [{ equals: 1, to: "n2" }],
      defaultTo: "n2",
    },
    { key: "n_par", type: "PARALLEL" },
    { key: "n_join", type: "JOIN" },
    {
      key: "n_app",
      type: "APPROVAL",
      title: "Approve",
      description: null as unknown as string | undefined,
    },
    {
      key: "n_wait_d",
      type: "WAIT",
      wait: { kind: "DURATION", durationMs: 1000 },
    },
    {
      key: "n_wait_u",
      type: "WAIT",
      wait: { kind: "UNTIL", until: "2026-01-01T00:00:00.000Z" },
    },
    {
      key: "n_wait_e",
      type: "WAIT",
      wait: {
        kind: "EVENT",
        source: "ext",
        eventType: "done",
        correlation: { kind: "LITERAL", value: "c1" },
        timeoutMs: null,
      },
    },
    {
      key: "n_wait_p",
      type: "WAIT",
      wait: {
        kind: "EVENT",
        source: "ext",
        eventType: "done",
        correlation: { kind: "INPUT_POINTER", pointer: "/input/id" },
        timeoutMs: 5000,
      },
    },
  ] as const;

  it.each(nodeVariants.map((node) => [node.type, node] as const))(
    "accepts workflow node variant %s",
    (_label, node) => {
      const base = withNullableExecution(
        baseProposal({
          workflow: {
            nodes: [node] as unknown as BuilderProposalV1["workflow"]["nodes"],
            edges: [],
          },
        }),
      );
      expect(parseBuilderProposalV1(base).ok).toBe(true);
    },
  );
});
