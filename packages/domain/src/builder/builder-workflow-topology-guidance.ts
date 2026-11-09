import type { BuilderIssueV1 } from "./builder-issue.js";

/**
 * Compact OSVA WorkflowDefinition V3 DAG rules enforced by
 * {@link assertDagWorkflowV3GraphTopology} during builder pre-publication compile.
 * Every pattern below is covered by compiler fixtures in
 * `builder-workflow-topology-hardening.test.ts`.
 */
export const BUILDER_WORKFLOW_TOPOLOGY_PROMPT_SECTION = `Workflow graph (OSVA V3 DAG — same rules as production compiler):
- Default for simple tasks: AGENT-only nodes. Do not add JOIN, PARALLEL, BRANCH, APPROVAL, or WAIT unless the user explicitly needs fan-in, fan-out, conditional routing, human approval, or external wait semantics.
- One agent (valid): workflow.nodes = [{ key, type: "AGENT", agentRef }], workflow.edges = [] — single entry and terminal.
- Two agents in sequence (valid): nodes A then B; edges [{ from: A.key, to: B.key }] — exactly one entry (A), one terminal (B).
- Global invariants: at least one node; unique node keys; edges reference existing nodes; no duplicate edges; acyclic; exactly one entry (zero incoming edges) and one terminal (zero outgoing edges); every node reachable from entry and able to reach terminal.
- AGENT / APPROVAL / WAIT: entry — 0 incoming, 1 outgoing (unless terminal); terminal — 1 incoming, 0 outgoing; middle — exactly 1 incoming and 1 outgoing (no implicit fan-in/out).
- PARALLEL: at least two outgoing edges; at most one incoming edge.
- JOIN: at least two incoming edges; at most one outgoing edge. Never use JOIN for a linear chain — use AGENT → AGENT edges instead.
- BRANCH: at least two outgoing edges; at most one incoming; every outgoing edge target must appear in cases[].to or defaultTo; defaultTo must be one of the outgoing targets.
- Genuine parallelism (only when required): AGENT → PARALLEL → (≥2 AGENT branches) → JOIN → downstream AGENT, with JOIN receiving one edge from each parallel branch.`;

export const BUILDER_WORKFLOW_TOPOLOGY_REPAIR_CHECKLIST = `Re-validate the full graph (all workflow.nodes and workflow.edges together):
- Exactly one entry node and one terminal node.
- No cycles; all nodes reachable from entry; all nodes can reach terminal.
- AGENT chains: one edge between consecutive agents; no orphan JOIN/PARALLEL nodes.
- JOIN: only after ≥2 parallel branches; never with only one incoming edge.
- Do not fix one error by creating a second terminal or disconnecting nodes.
- Preserve user intent, agent refs, instructions, and catalog model/tool bindings unless they cause separate errors.`;

export function buildBuilderCompileFailureRepairHint(
  issues: readonly BuilderIssueV1[],
): string {
  const compileLines = issues.slice(0, 12).map((issue) => {
    const where =
      issue.location?.kind === "workflow_node"
        ? ` (node ${issue.location.nodeKey})`
        : issue.location?.kind === "workflow_edge"
          ? ` (edge ${issue.location.from}→${issue.location.to})`
          : issue.location?.kind === "agent_spec" &&
              issue.location.ref !== undefined
            ? ` (agent ${issue.location.ref})`
            : "";
    return `  - [${issue.code}]${where}: ${issue.message}`;
  });

  const topologyNotes: string[] = [];
  for (const issue of issues) {
    if (issue.code !== "INVALID_GRAPH_TOPOLOGY") {
      continue;
    }
    const msg = issue.message.toLowerCase();
    if (msg.includes("join") && msg.includes("incoming")) {
      topologyNotes.push(
        "  - JOIN requires at least two incoming edges from distinct predecessors (typical fix: remove JOIN and use a linear AGENT chain, or add PARALLEL fan-out with two branches into JOIN).",
      );
    }
    if (msg.includes("terminal node")) {
      topologyNotes.push(
        "  - Exactly one node may have zero outgoing edges (the terminal). Merge or remove extra terminals; ensure the intended final AGENT has no outgoing edges.",
      );
    }
    if (msg.includes("entry node")) {
      topologyNotes.push(
        "  - Exactly one node may have zero incoming edges (the entry).",
      );
    }
    if (msg.includes("cycle")) {
      topologyNotes.push("  - Remove back-edges to break cycles.");
    }
    if (msg.includes("reachable")) {
      topologyNotes.push(
        "  - Connect every node on a path from entry to terminal; remove orphan nodes or add edges.",
      );
    }
  }

  const sections = [
    "- Pre-publication compilation failed.",
    "- Return a corrected full BuilderProposalV1 JSON object (not a partial patch).",
    BUILDER_WORKFLOW_TOPOLOGY_REPAIR_CHECKLIST,
    ...compileLines,
  ];

  if (topologyNotes.length > 0) {
    sections.push("- Topology hints:", ...topologyNotes);
  }

  return sections.join("\n");
}
