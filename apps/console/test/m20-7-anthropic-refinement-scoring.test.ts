import type { ModelProfileVersionId, WorkspaceId } from "@osva-ai/contracts";
import {
  ANTHROPIC_RECORDS_ENCODING,
  buildBuilderCatalogIndex,
  compileBuilderProposalPrePublication,
  decodeBuilderProposalProviderOutput,
  encodeBuilderProposalAsAnthropicRecords,
  parseBuilderProposalV1,
  type BuilderProposalV1,
} from "@osva/domain/builder";
import { describe, expect, it } from "vitest";

import {
  classifyAnthropicRefinementProbeOutcome,
  scoreAnthropicApprovalInsertionRefinement,
} from "./integration/m20-7-anthropic-refinement-eval.js";
import {
  ANTHROPIC_REFINEMENT_AGENT_NODE_KEY,
  ANTHROPIC_REFINEMENT_SUMMARIZER_INSTRUCTIONS,
  anthropicRefinementBaseProposal,
  anthropicRefinementScoringCatalog,
  expectedAnthropicApprovalRefinement,
} from "./integration/m20-7-anthropic-refinement-fixture.js";

const mpv = "mpv-anthropic-refine" as ModelProfileVersionId;
const workspaceId = "wrkspc_m20_7_4_refine" as WorkspaceId;
const catalog = anthropicRefinementScoringCatalog(workspaceId, mpv);

describe("M20.7.4 Anthropic approval-insertion refinement scoring", () => {
  it("fixture is canonical, compiles, and round-trips records V2", () => {
    const base = anthropicRefinementBaseProposal(mpv);
    const parsed = parseBuilderProposalV1(base);
    expect(parsed.ok).toBe(true);
    const encoded = encodeBuilderProposalAsAnthropicRecords(base);
    expect(encoded.encoding).toBe(ANTHROPIC_RECORDS_ENCODING);
    const decoded = decodeBuilderProposalProviderOutput(encoded);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }
    const reparsed = parseBuilderProposalV1(decoded.proposal);
    expect(reparsed.ok).toBe(true);
    const compiled = compileBuilderProposalPrePublication(
      base,
      buildBuilderCatalogIndex(catalog),
    );
    expect(compiled.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("expected APPROVAL-before-AGENT refinement scores 2", () => {
    const base = anthropicRefinementBaseProposal(mpv);
    const refined = expectedAnthropicApprovalRefinement(mpv);
    const score = scoreAnthropicApprovalInsertionRefinement(
      base,
      refined,
      catalog,
    );
    expect(score.compileOk).toBe(true);
    expect(score.reasons).toEqual([]);
    expect(score.score).toBe(2);
  });

  it("HTTP-ok identity clone without APPROVAL is not a pass", () => {
    const base = anthropicRefinementBaseProposal(mpv);
    const score = scoreAnthropicApprovalInsertionRefinement(
      base,
      base,
      catalog,
    );
    expect(score.score).toBeLessThan(2);
    expect(score.reasons).toContain("missing_approval_node");
    expect(score.reasons).toContain("approval_not_before_final_agent");
  });

  it("APPROVAL after the AGENT fails order", () => {
    const base = anthropicRefinementBaseProposal(mpv);
    const refined: BuilderProposalV1 = {
      ...base,
      workflow: {
        nodes: [
          ...base.workflow.nodes,
          {
            key: "review_summary",
            type: "APPROVAL",
            title: "Review weekly summary",
          },
        ],
        edges: [
          { from: ANTHROPIC_REFINEMENT_AGENT_NODE_KEY, to: "review_summary" },
        ],
      },
    };
    const score = scoreAnthropicApprovalInsertionRefinement(
      base,
      refined,
      catalog,
    );
    expect(score.reasons).toContain("approval_not_before_final_agent");
    expect(score.score).toBeLessThan(2);
  });

  it("preserves identity failures when workflow key drifts", () => {
    const base = anthropicRefinementBaseProposal(mpv);
    const refined: BuilderProposalV1 = {
      ...expectedAnthropicApprovalRefinement(mpv),
      workflowRegistry: { key: "other-workflow", name: "Other" },
    };
    const score = scoreAnthropicApprovalInsertionRefinement(
      base,
      refined,
      catalog,
    );
    expect(score.reasons).toContain("workflow_identity");
  });

  it("summarizer instruction drift fails", () => {
    const base = anthropicRefinementBaseProposal(mpv);
    const refined = expectedAnthropicApprovalRefinement(mpv);
    const drifted: BuilderProposalV1 = {
      ...refined,
      agents: refined.agents.map((agent) =>
        agent.kind === "NEW"
          ? { ...agent, instructions: "Completely different task." }
          : agent,
      ),
    };
    const score = scoreAnthropicApprovalInsertionRefinement(
      base,
      drifted,
      catalog,
    );
    expect(score.reasons).toContain("summarizer_instructions_drift");
    expect(score.score).toBeLessThan(2);
  });

  it("extra agent is not a pass", () => {
    const base = anthropicRefinementBaseProposal(mpv);
    const refined = expectedAnthropicApprovalRefinement(mpv);
    const withExtra: BuilderProposalV1 = {
      ...refined,
      agents: [
        ...refined.agents,
        {
          kind: "NEW",
          ref: "bpr_extra",
          agentKey: "extra",
          agentName: "Extra",
          instructions: ANTHROPIC_REFINEMENT_SUMMARIZER_INSTRUCTIONS,
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          modelBindingName: "default",
          model: { bindingName: "default", modelProfileVersionId: mpv },
          tools: [],
          execution: {
            timeoutMs: 30_000,
            maxAttempts: 2,
            maxModelInvocations: 4,
            maxToolInvocations: 0,
          },
        },
      ],
    };
    const score = scoreAnthropicApprovalInsertionRefinement(
      base,
      withExtra,
      catalog,
    );
    expect(score.reasons).toContain("extra_agents");
  });

  it("JSON ok without rubric 2 classifies as refinement fail", () => {
    expect(
      classifyAnthropicRefinementProbeOutcome({
        httpStatus: 200,
        providerAttempts: 1,
        repairAttempted: false,
        parsed: { ok: true },
        rubricScore: 1,
        compileOk: true,
        canonicalOk: true,
      }),
    ).toBe("BUILDER_REFINEMENT_FAIL");

    expect(
      classifyAnthropicRefinementProbeOutcome({
        httpStatus: 200,
        providerAttempts: 1,
        repairAttempted: false,
        parsed: { ok: true },
        rubricScore: 2,
        compileOk: true,
        canonicalOk: true,
      }),
    ).toBe("BUILDER_REFINEMENT_PASS");
  });
});
