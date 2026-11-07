import type { ModelProfileVersionId } from "@osva-ai/contracts";
import type { BuilderProposalV1 } from "@osva/domain/builder";

/** Fallback when catalog JSON is absent (unit tests). */
export const M20_6_EXEC_MPV = "mpv-m20-6-exec" as ModelProfileVersionId;
export const M20_6_ALT_MPV = "mpv-m20-6-exec-alt" as ModelProfileVersionId;

function extractCatalogModelProfileIds(
  userText: string,
): readonly ModelProfileVersionId[] {
  const start = userText.indexOf("=== CAPABILITY_CATALOG_JSON ===");
  const end = userText.indexOf("=== END_CAPABILITY_CATALOG_JSON ===");
  if (start < 0 || end < 0 || end <= start) {
    return [];
  }
  const raw = userText
    .slice(start, end)
    .replace("=== CAPABILITY_CATALOG_JSON ===", "")
    .trim();
  try {
    const catalog = JSON.parse(raw) as {
      modelProfileVersions?: Array<{ modelProfileVersionId?: string }>;
    };
    return (catalog.modelProfileVersions ?? [])
      .map((e) => e.modelProfileVersionId)
      .filter((id): id is string => typeof id === "string")
      .map((id) => id as ModelProfileVersionId);
  } catch {
    return [];
  }
}

function pickExecAndAlt(userText: string): {
  exec: ModelProfileVersionId;
  alt: ModelProfileVersionId;
} {
  const ids = extractCatalogModelProfileIds(userText);
  const exec = ids[0] ?? M20_6_EXEC_MPV;
  const alt = ids[1] ?? ids[0] ?? M20_6_ALT_MPV;
  return { exec, alt };
}

const SCENARIO_MARKER = /OSVA_M20_6_SCENARIO=([a-z0-9-]+)/i;
const REFINEMENT_BLOCK =
  /=== REFINEMENT_INSTRUCTION ===\s*([\s\S]*?)\s*=== END_REFINEMENT_INSTRUCTION ===/;

function agent(
  ref: `bpr_${string}`,
  key: string,
  name: string,
  mpv: ModelProfileVersionId = M20_6_EXEC_MPV,
  timeoutMs = 30_000,
): BuilderProposalV1["agents"][number] {
  return {
    kind: "NEW",
    ref,
    agentKey: key,
    agentName: name,
    instructions: `Perform the ${name} step.`,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    modelBindingName: "default",
    model: { bindingName: "default", modelProfileVersionId: mpv },
    tools: [],
    execution: {
      timeoutMs,
      maxAttempts: 2,
      maxModelInvocations: 4,
      maxToolInvocations: 0,
    },
  };
}

function scenarioSimple(exec: ModelProfileVersionId): BuilderProposalV1 {
  const a = agent("bpr_sum", "summarize", "Summarizer", exec);
  return {
    schemaVersion: "1",
    workflowRegistry: { key: "wf_simple", name: "Simple summarization" },
    agents: [a],
    workflow: {
      nodes: [{ key: "n1", type: "AGENT", agentRef: "bpr_sum" }],
      edges: [],
    },
    assumptions: [],
    unresolvedRequirements: [],
  };
}

function scenarioSequential(exec: ModelProfileVersionId): BuilderProposalV1 {
  const research = agent("bpr_res", "research", "Research", exec);
  const analysis = agent("bpr_ana", "analysis", "Analysis", exec);
  const report = agent("bpr_rep", "report", "Report", exec);
  return {
    schemaVersion: "1",
    workflowRegistry: { key: "wf_seq", name: "Research pipeline" },
    agents: [research, analysis, report],
    workflow: {
      nodes: [
        { key: "research", type: "AGENT", agentRef: "bpr_res" },
        { key: "analysis", type: "AGENT", agentRef: "bpr_ana" },
        { key: "report", type: "AGENT", agentRef: "bpr_rep" },
      ],
      edges: [
        { from: "research", to: "analysis" },
        { from: "analysis", to: "report" },
      ],
    },
    assumptions: [],
    unresolvedRequirements: [],
  };
}

function scenarioParallel(exec: ModelProfileVersionId): BuilderProposalV1 {
  const research = agent("bpr_res", "research", "Research", exec);
  const analystA = agent("bpr_a1", "analyst_a", "Analyst A", exec);
  const analystB = agent("bpr_a2", "analyst_b", "Analyst B", exec);
  const report = agent("bpr_rep", "report", "Report", exec);
  return {
    schemaVersion: "1",
    workflowRegistry: { key: "wf_parallel", name: "Parallel analysis" },
    agents: [research, analystA, analystB, report],
    workflow: {
      nodes: [
        { key: "research", type: "AGENT", agentRef: "bpr_res" },
        { key: "fork", type: "PARALLEL" },
        { key: "a1", type: "AGENT", agentRef: "bpr_a1" },
        { key: "a2", type: "AGENT", agentRef: "bpr_a2" },
        { key: "join", type: "JOIN" },
        { key: "report", type: "AGENT", agentRef: "bpr_rep" },
      ],
      edges: [
        { from: "research", to: "fork" },
        { from: "fork", to: "a1" },
        { from: "fork", to: "a2" },
        { from: "a1", to: "join" },
        { from: "a2", to: "join" },
        { from: "join", to: "report" },
      ],
    },
    assumptions: [],
    unresolvedRequirements: [],
  };
}

function scenarioApproval(exec: ModelProfileVersionId): BuilderProposalV1 {
  const research = agent("bpr_res", "research", "Research", exec);
  const draft = agent("bpr_draft", "draft", "Draft", exec);
  const report = agent("bpr_rep", "report", "Report", exec);
  return {
    schemaVersion: "1",
    workflowRegistry: { key: "wf_approval", name: "Approval gate" },
    agents: [research, draft, report],
    workflow: {
      nodes: [
        { key: "research", type: "AGENT", agentRef: "bpr_res" },
        { key: "draft", type: "AGENT", agentRef: "bpr_draft" },
        { key: "approval", type: "APPROVAL", title: "Human review" },
        { key: "report", type: "AGENT", agentRef: "bpr_rep" },
      ],
      edges: [
        { from: "research", to: "draft" },
        { from: "draft", to: "approval" },
        { from: "approval", to: "report" },
      ],
    },
    assumptions: [],
    unresolvedRequirements: [],
  };
}

function scenarioWaitEvent(exec: ModelProfileVersionId): BuilderProposalV1 {
  const ingest = agent("bpr_ing", "ingest", "Ingest", exec);
  const finalize = agent("bpr_fin", "finalize", "Finalize", exec);
  return {
    schemaVersion: "1",
    workflowRegistry: { key: "wf_wait", name: "Event wait" },
    agents: [ingest, finalize],
    workflow: {
      nodes: [
        { key: "ingest", type: "AGENT", agentRef: "bpr_ing" },
        {
          key: "wait",
          type: "WAIT",
          wait: {
            kind: "EVENT",
            source: "synthetic.acceptance",
            eventType: "m20_6.ready",
            correlation: { kind: "LITERAL", value: "acceptance-correlation" },
            timeoutMs: 60_000,
          },
        },
        { key: "finalize", type: "AGENT", agentRef: "bpr_fin" },
      ],
      edges: [
        { from: "ingest", to: "wait" },
        { from: "wait", to: "finalize" },
      ],
    },
    assumptions: [],
    unresolvedRequirements: [],
  };
}

function scenarioConversationalBase(
  exec: ModelProfileVersionId,
): BuilderProposalV1 {
  return scenarioSequential(exec);
}

function applyRefinement(
  baseJson: string,
  refinementInstruction: string,
  userText?: string,
): BuilderProposalV1 | undefined {
  let base: BuilderProposalV1;
  try {
    base = JSON.parse(baseJson) as BuilderProposalV1;
  } catch {
    return undefined;
  }

  const lower = refinementInstruction.toLowerCase();

  const { exec, alt } = pickExecAndAlt(
    userText ?? `=== REFINEMENT_INSTRUCTION ===\n${refinementInstruction}`,
  );

  if (lower.includes("fact-check") || lower.includes("fact check")) {
    if (base.agents.some((a) => a.ref === "bpr_fc")) {
      return base;
    }
    const fc = agent("bpr_fc", "fact_check", "Fact check", exec);
    return {
      ...base,
      agents: [...base.agents, fc],
      workflow: {
        nodes: [
          ...base.workflow.nodes,
          { key: "n_fc", type: "AGENT", agentRef: "bpr_fc" },
        ],
        edges: [...base.workflow.edges, { from: "report", to: "n_fc" }],
      },
    };
  }

  if (lower.includes("model") && lower.includes("binding")) {
    return {
      ...base,
      agents: base.agents.map((a) =>
        a.kind === "NEW" && a.ref === "bpr_res"
          ? {
              ...a,
              model: {
                ...a.model,
                modelProfileVersionId: alt,
              },
            }
          : a,
      ),
    };
  }

  if (lower.includes("timeout")) {
    return {
      ...base,
      agents: base.agents.map((a) =>
        a.kind === "NEW" && a.ref === "bpr_ana"
          ? {
              ...a,
              execution: { ...a.execution, timeoutMs: 120_000 },
            }
          : a,
      ),
    };
  }

  if (lower.includes("remove") || lower.includes("unnecessary")) {
    const nodes = base.workflow.nodes.filter((n) => n.key !== "report");
    let edges = base.workflow.edges.filter(
      (e) => e.from !== "report" && e.to !== "report",
    );
    const hadReportToFc = base.workflow.edges.some(
      (e) => e.from === "report" && e.to === "n_fc",
    );
    if (
      hadReportToFc &&
      nodes.some((n) => n.key === "n_fc") &&
      !edges.some((e) => e.from === "analysis" && e.to === "n_fc")
    ) {
      edges = [...edges, { from: "analysis", to: "n_fc" }];
    }
    return {
      ...base,
      agents: base.agents.filter((a) => a.ref !== "bpr_rep"),
      workflow: { nodes, edges },
    };
  }

  return base;
}

function isolateScenarioPublicationIds(
  scenarioId: string,
  proposal: BuilderProposalV1,
): BuilderProposalV1 {
  const keyPrefix = scenarioId.replaceAll("-", "_");
  return {
    ...proposal,
    workflowRegistry: {
      ...proposal.workflowRegistry,
      key: `${keyPrefix}_${proposal.workflowRegistry.key}`,
    },
    agents: proposal.agents.map((a) =>
      a.kind === "NEW" ? { ...a, agentKey: `${keyPrefix}_${a.agentKey}` } : a,
    ),
  };
}

function proposalForScenarioId(
  id: string,
  userText: string,
): BuilderProposalV1 | undefined {
  const { exec } = pickExecAndAlt(userText);
  let proposal: BuilderProposalV1 | undefined;
  switch (id) {
    case "simple":
      proposal = scenarioSimple(exec);
      break;
    case "sequential":
      proposal = scenarioSequential(exec);
      break;
    case "parallel":
      proposal = scenarioParallel(exec);
      break;
    case "approval":
      proposal = scenarioApproval(exec);
      break;
    case "wait-event":
      proposal = scenarioWaitEvent(exec);
      break;
    case "conversational-refinement":
      proposal = scenarioConversationalBase(exec);
      break;
    default:
      return undefined;
  }
  return isolateScenarioPublicationIds(id, proposal);
}

function extractCurrentProposalJson(userText: string): string | undefined {
  const start = userText.indexOf("=== CURRENT_BUILDER_PROPOSAL_JSON ===");
  const end = userText.indexOf("=== END_CURRENT_BUILDER_PROPOSAL_JSON ===");
  if (start < 0 || end < 0 || end <= start) {
    return undefined;
  }
  return userText
    .slice(start, end)
    .replace("=== CURRENT_BUILDER_PROPOSAL_JSON ===", "")
    .trim();
}

/**
 * Deterministic fake OpenAI builder responses for M20.6 acceptance (no live model).
 */
export function resolveM20_6BuilderFakeProposal(
  userText: string,
): BuilderProposalV1 | undefined {
  const refineMatch = REFINEMENT_BLOCK.exec(userText);
  if (refineMatch !== null) {
    const instruction = refineMatch[1] ?? "";
    const baseJson = extractCurrentProposalJson(userText);
    if (baseJson !== undefined) {
      return applyRefinement(baseJson, instruction, userText);
    }
  }

  const scenarioMatch = SCENARIO_MARKER.exec(userText);
  if (scenarioMatch === null) {
    return undefined;
  }

  return proposalForScenarioId(scenarioMatch[1]!.toLowerCase(), userText);
}

export function listM20_6ScenarioIds(): readonly string[] {
  return [
    "simple",
    "sequential",
    "parallel",
    "approval",
    "wait-event",
    "conversational-refinement",
  ];
}
