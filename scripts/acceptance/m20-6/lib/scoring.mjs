/**
 * @typedef {"PASS" | "PARTIAL" | "FAIL" | "ERROR" | "NOT_RUN" | "UNSUPPORTED_PRECONDITION"} ScenarioStatus
 */

/**
 * @typedef {Object} RubricScore
 * @property {0 | 1 | 2} structural
 * @property {0 | 1 | 2} intent
 * @property {0 | 1 | 2} [refinement]
 * @property {0 | 1 | 2} [publication]
 * @property {0 | 1 | 2} [safety]
 */

/**
 * @param {unknown} proposal
 * @param {Record<string, unknown>} structural
 */
export function scoreStructural(proposal, structural) {
  if (proposal === null || typeof proposal !== "object") {
    return /** @type {const} */ ({
      status: "FAIL",
      score: 0,
      reasons: ["missing_proposal"],
    });
  }
  const p = /** @type {Record<string, unknown>} */ (proposal);
  const agents = Array.isArray(p.agents) ? p.agents : [];
  const workflow =
    p.workflow !== null && typeof p.workflow === "object"
      ? /** @type {Record<string, unknown>} */ (p.workflow)
      : {};
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const reasons = [];

  const newAgents = agents.filter(
    (a) => a !== null && typeof a === "object" && a.kind === "NEW",
  );

  if (
    typeof structural.minNewAgents === "number" &&
    newAgents.length < structural.minNewAgents
  ) {
    reasons.push("minNewAgents");
  }
  if (
    typeof structural.maxNewAgents === "number" &&
    newAgents.length > structural.maxNewAgents
  ) {
    reasons.push("maxNewAgents");
  }

  const nodeTypes = new Set(
    nodes.map((n) =>
      n !== null && typeof n === "object"
        ? /** @type {Record<string, unknown>} */ (n).type
        : undefined,
    ),
  );

  for (const required of structural.requireNodeTypes ?? []) {
    if (!nodeTypes.has(required)) {
      reasons.push(`missing_node_type:${required}`);
    }
  }
  for (const forbidden of structural.forbidNodeTypes ?? []) {
    if (nodeTypes.has(forbidden)) {
      reasons.push(`forbidden_node_type:${forbidden}`);
    }
  }

  if (typeof structural.forbidNodeKey === "string") {
    if (
      nodes.some(
        (n) =>
          n !== null &&
          typeof n === "object" &&
          /** @type {Record<string, unknown>} */ (n).key ===
            structural.forbidNodeKey,
      )
    ) {
      reasons.push(`forbidden_node_key:${structural.forbidNodeKey}`);
    }
  }

  const toolBindings = newAgents.reduce((acc, a) => {
    const tools = Array.isArray(a.tools) ? a.tools.length : 0;
    return acc + tools;
  }, 0);
  if (
    typeof structural.maxToolBindings === "number" &&
    toolBindings > structural.maxToolBindings
  ) {
    reasons.push("maxToolBindings");
  }

  const score =
    reasons.length === 0
      ? 2
      : reasons.length <= 2
        ? /** @type {const} */ (1)
        : 0;
  return {
    status: score === 2 ? "PASS" : score === 1 ? "PARTIAL" : "FAIL",
    score,
    reasons,
  };
}

/**
 * @param {RubricScore} rubric
 */
export function aggregateScenarioVerdict(rubric) {
  const values = Object.values(rubric).filter((v) => typeof v === "number");
  if (values.length === 0) {
    return "ERROR";
  }
  if (values.every((v) => v === 2)) {
    return "PASS";
  }
  if (values.some((v) => v === 0)) {
    return "FAIL";
  }
  return "PARTIAL";
}
