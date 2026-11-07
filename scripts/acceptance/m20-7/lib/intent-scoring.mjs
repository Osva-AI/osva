/**
 * Evidence-backed intent rubric for live scenarios (no LLM judge).
 *
 * @param {unknown} proposal
 * @param {Record<string, unknown>} manifestScenario
 * @returns {{ score: 0 | 1 | 2, reasons: string[], requiresHumanReview: boolean }}
 */
export function scoreLiveIntent(proposal, manifestScenario) {
  const reasons = [];
  if (proposal === null || typeof proposal !== "object") {
    return {
      score: 0,
      reasons: ["missing_proposal"],
      requiresHumanReview: false,
    };
  }
  const p = /** @type {Record<string, unknown>} */ (proposal);
  const agents = Array.isArray(p.agents) ? p.agents : [];
  const workflow =
    p.workflow !== null && typeof p.workflow === "object"
      ? /** @type {Record<string, unknown>} */ (p.workflow)
      : {};
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const rubric = Array.isArray(manifestScenario.intentRubric)
    ? manifestScenario.intentRubric
    : [];

  const newAgents = agents.filter(
    (a) => a !== null && typeof a === "object" && a.kind === "NEW",
  );

  for (const item of rubric) {
    switch (item) {
      case "single_agent":
        if (newAgents.length !== 1) reasons.push("single_agent");
        break;
      case "three_stages":
        if (newAgents.length < 3) reasons.push("three_stages");
        break;
      case "parallel_topology": {
        const types = new Set(
          nodes.map((n) =>
            n !== null && typeof n === "object" ? n.type : undefined,
          ),
        );
        if (!types.has("PARALLEL")) reasons.push("parallel_topology");
        break;
      }
      case "join_present": {
        const types = new Set(
          nodes.map((n) =>
            n !== null && typeof n === "object" ? n.type : undefined,
          ),
        );
        if (!types.has("JOIN")) reasons.push("join_present");
        break;
      }
      case "approval_gate": {
        const types = new Set(
          nodes.map((n) =>
            n !== null && typeof n === "object" ? n.type : undefined,
          ),
        );
        if (!types.has("APPROVAL")) reasons.push("approval_gate");
        break;
      }
      case "wait_semantics": {
        const types = new Set(
          nodes.map((n) =>
            n !== null && typeof n === "object" ? n.type : undefined,
          ),
        );
        if (!types.has("WAIT")) reasons.push("wait_semantics");
        break;
      }
      case "refinement_accuracy":
      case "ordered_dependencies":
      case "not_bypassed":
      case "no_invented_tools":
      case "stable_refs":
      case "valid_model_binding":
        break;
      default:
        break;
    }
  }

  const structuralOnly = rubric.some((r) =>
    [
      "refinement_accuracy",
      "ordered_dependencies",
      "not_bypassed",
      "stable_refs",
    ].includes(String(r)),
  );

  if (reasons.length === 0) {
    if (structuralOnly && rubric.length > 0) {
      return {
        score: 1,
        reasons: ["semantic_intent_needs_human_review"],
        requiresHumanReview: true,
      };
    }
    return { score: 2, reasons: [], requiresHumanReview: false };
  }
  if (reasons.length <= 1) {
    return { score: 1, reasons, requiresHumanReview: false };
  }
  return { score: 0, reasons, requiresHumanReview: false };
}
