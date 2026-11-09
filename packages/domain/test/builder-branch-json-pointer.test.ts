import type {
  AgentVersionId,
  ModelProfileId,
  ModelProfileVersionId,
  ToolVersionId,
} from "@osva-ai/contracts";
import {
  isValidJsonPointer,
  RFC6901_JSON_POINTER_PATTERN,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { buildBuilderCatalogIndex } from "../src/builder/builder-compiler.js";
import { buildBuilderProposalParseRepairHint } from "../src/builder/builder-json-pointer-guidance.js";
import { buildBuilderGenerationMessages } from "../src/builder/builder-natural-language-prompt.js";
import { validateBuilderProposalModelOutputPipeline } from "../src/builder/builder-proposal-model-output-pipeline.js";
import { BuilderProposalOpenAiJsonSchema } from "../src/builder/builder-proposal-openai-json-schema.js";
import { parseBuilderProposalV1 } from "../src/builder/builder-proposal-schema.js";
import type { WorkspaceBuilderCapabilityCatalogV1 } from "../src/builder/workspace-builder-capability-catalog.js";
import { baseProposal } from "./builder-natural-language-test-helpers.js";
import { workspaceId } from "./fixtures.js";

describe("BRANCH JSON Pointer validation", () => {
  const pattern = new RegExp(RFC6901_JSON_POINTER_PATTERN);

  function proposalWithSelector(selector: string): unknown {
    return {
      ...baseProposal(),
      workflow: {
        nodes: [
          {
            key: "route",
            type: "BRANCH",
            selector,
            cases: [{ equals: "yes", to: "n1" }],
            defaultTo: "n2",
          },
          { key: "n1", type: "AGENT", agentRef: "bpr_a" },
          { key: "n2", type: "AGENT", agentRef: "bpr_a" },
        ],
        edges: [
          { from: "route", to: "n1" },
          { from: "route", to: "n2" },
        ],
      },
    };
  }

  function catalogIndex() {
    const catalog: WorkspaceBuilderCapabilityCatalogV1 = {
      workspaceId,
      agentVersions: [],
      modelProfileVersions: [
        {
          modelProfileVersionId: "mpv-test" as ModelProfileVersionId,
          modelProfileId: "mp-test" as ModelProfileId,
          modelProfileKey: "default",
          modelProfileName: "Default",
          version: 1,
          provider: "OPENAI",
          model: "gpt-4o-mini",
        },
      ],
      toolVersions: [],
    };
    return buildBuilderCatalogIndex(catalog);
  }

  function promptVisible() {
    return {
      agentVersionIds: new Set<AgentVersionId>(),
      modelProfileVersionIds: new Set<ModelProfileVersionId>([
        "mpv-test" as ModelProfileVersionId,
      ]),
      toolVersionIds: new Set<ToolVersionId>(),
    };
  }

  it("accepts valid JSON Pointer selectors", () => {
    for (const selector of ["/status", "/analysis/result", "/a~1b"]) {
      expect(isValidJsonPointer(selector)).toBe(true);
      const parsed = parseBuilderProposalV1(proposalWithSelector(selector));
      expect(parsed.ok).toBe(true);
    }
  });

  it("rejects dot notation, JSONPath, templates, and invalid escapes", () => {
    for (const selector of [
      "analysis.result",
      "$.status",
      "{{status}}",
      "/a~2",
    ]) {
      expect(isValidJsonPointer(selector)).toBe(false);
      const parsed = parseBuilderProposalV1(proposalWithSelector(selector));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.messages.some((m) => m.includes("JSON Pointer"))).toBe(
          true,
        );
      }
    }
  });

  it("aligns provider schema BRANCH selector pattern with isValidJsonPointer", () => {
    const branch = (
      BuilderProposalOpenAiJsonSchema as {
        properties: {
          workflow: {
            properties: { nodes: { items: { anyOf: unknown[] } } };
          };
        };
      }
    ).properties.workflow.properties.nodes.items.anyOf[1] as {
      properties: { selector: { pattern?: string } };
    };
    expect(branch.properties.selector.pattern).toBe(
      RFC6901_JSON_POINTER_PATTERN,
    );
    expect(pattern.test("/status")).toBe(true);
    expect(pattern.test("$.status")).toBe(false);
  });

  it("enriches repair hints with field-specific JSON Pointer guidance", () => {
    const hint = buildBuilderProposalParseRepairHint([
      "workflow.nodes[0]: BRANCH selector must be a valid JSON Pointer.",
    ]);
    expect(hint).toContain("workflow.nodes[0].selector");
    expect(hint).toContain("/status");
    expect(hint).toContain("$.status");
  });

  it("includes JSON Pointer guidance in generation system prompt", () => {
    const messages = buildBuilderGenerationMessages("{}", "test");
    expect(messages[0]?.content).toContain("RFC 6901");
    expect(messages[0]?.content).toContain("/analysis/result");
    expect(messages[0]?.content).toContain("$.status");
  });

  it("pipeline repair hints identify invalid BRANCH selector", () => {
    const invalid = proposalWithSelector("$.status");
    const first = validateBuilderProposalModelOutputPipeline(
      JSON.stringify(invalid),
      catalogIndex(),
      promptVisible(),
    );
    expect(first.kind).toBe("hard_fail");
    if (first.kind === "hard_fail") {
      expect(first.repairHint).toContain("workflow.nodes[0].selector");
      expect(first.repairHint).toContain("JSON Pointer");
    }
  });

  it("corrected proposal parses and preserves unrelated agent definition", () => {
    const fixed = proposalWithSelector("/status");
    const parsed = parseBuilderProposalV1(fixed);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(parsed.proposal.agents).toHaveLength(1);
    expect(parsed.proposal.agents[0]?.kind).toBe("NEW");
    expect(parsed.proposal.agents[0]?.ref).toBe("bpr_a");
    const branch = parsed.proposal.workflow.nodes[0];
    expect(branch?.type).toBe("BRANCH");
    if (branch?.type === "BRANCH") {
      expect(branch.selector).toBe("/status");
    }
  });
});
