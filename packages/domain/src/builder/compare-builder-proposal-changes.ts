import type {
  AgentVersionId,
  ModelProfileVersionId,
  ToolVersionId,
} from "@osva-ai/contracts";

import { jsonValuesEqual } from "../json-equality.js";
import type { JsonValue } from "@osva-ai/contracts";

import type {
  BuilderProposalAgentSpecV1,
  BuilderProposalNewAgentV1,
  BuilderProposalV1,
  BuilderProposalWorkflowNodeIntentV1,
} from "./builder-proposal.js";

export interface BuilderProposalRegistryChangeV1 {
  readonly field: "key" | "name" | "description";
  readonly before: string | undefined;
  readonly after: string | undefined;
}

export interface BuilderProposalAgentAdditionV1 {
  readonly ref: string;
  readonly kind: "NEW" | "EXISTING";
  readonly summary: string;
}

export interface BuilderProposalAgentRemovalV1 {
  readonly ref: string;
  readonly kind: "NEW" | "EXISTING";
  readonly summary: string;
}

export interface BuilderProposalAgentModificationV1 {
  readonly ref: string;
  readonly kind: "NEW" | "EXISTING";
  readonly fields: readonly string[];
}

export interface BuilderProposalGraphNodeChangeV1 {
  readonly kind: "added" | "removed" | "modified";
  readonly nodeKey: string;
  readonly nodeType: string;
  readonly detail?: string;
}

export interface BuilderProposalGraphEdgeChangeV1 {
  readonly kind: "added" | "removed";
  readonly from: string;
  readonly to: string;
}

export interface BuilderProposalStringListChangeV1 {
  readonly kind: "assumptions" | "unresolvedRequirements";
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

export interface BuilderProposalChangesetV1 {
  readonly noop: boolean;
  readonly registryChanges: readonly BuilderProposalRegistryChangeV1[];
  readonly addedAgents: readonly BuilderProposalAgentAdditionV1[];
  readonly removedAgents: readonly BuilderProposalAgentRemovalV1[];
  readonly modifiedAgents: readonly BuilderProposalAgentModificationV1[];
  readonly graphNodeChanges: readonly BuilderProposalGraphNodeChangeV1[];
  readonly graphEdgeChanges: readonly BuilderProposalGraphEdgeChangeV1[];
  readonly stringListChanges: readonly BuilderProposalStringListChangeV1[];
}

function agentByRef(
  agents: readonly BuilderProposalAgentSpecV1[],
): Map<string, BuilderProposalAgentSpecV1> {
  const map = new Map<string, BuilderProposalAgentSpecV1>();
  for (const a of agents) {
    map.set(a.ref, a);
  }
  return map;
}

function agentSummary(spec: BuilderProposalAgentSpecV1): string {
  if (spec.kind === "EXISTING") {
    return `EXISTING ${spec.agentVersionId}`;
  }
  return `NEW ${spec.agentName} (${spec.agentKey})`;
}

function newAgentFieldChanges(
  before: BuilderProposalNewAgentV1,
  after: BuilderProposalNewAgentV1,
): string[] {
  const fields: string[] = [];
  if (before.agentKey !== after.agentKey) {
    fields.push("agentKey");
  }
  if (before.agentName !== after.agentName) {
    fields.push("agentName");
  }
  if (before.instructions !== after.instructions) {
    fields.push("instructions");
  }
  if (
    before.model.modelProfileVersionId !== after.model.modelProfileVersionId
  ) {
    fields.push("model.modelProfileVersionId");
  }
  if (before.model.bindingName !== after.model.bindingName) {
    fields.push("model.bindingName");
  }
  if (
    !jsonValuesEqual(
      before.inputSchema as unknown as JsonValue,
      after.inputSchema as unknown as JsonValue,
    )
  ) {
    fields.push("inputSchema");
  }
  if (
    !jsonValuesEqual(
      before.outputSchema as unknown as JsonValue,
      after.outputSchema as unknown as JsonValue,
    )
  ) {
    fields.push("outputSchema");
  }
  if (
    !jsonValuesEqual(
      before.execution as unknown as JsonValue,
      after.execution as unknown as JsonValue,
    )
  ) {
    fields.push("execution");
  }
  const beforeTools = [...before.tools]
    .map((t) => `${t.bindingName}:${t.toolVersionId}`)
    .sort();
  const afterTools = [...after.tools]
    .map((t) => `${t.bindingName}:${t.toolVersionId}`)
    .sort();
  if (beforeTools.join(",") !== afterTools.join(",")) {
    fields.push("tools");
  }
  return fields;
}

function nodeSignature(node: BuilderProposalWorkflowNodeIntentV1): string {
  return JSON.stringify(node);
}

function edgeKey(from: string, to: string): string {
  return `${from}\t${to}`;
}

function compareStringList(
  kind: "assumptions" | "unresolvedRequirements",
  before: readonly string[],
  after: readonly string[],
): BuilderProposalStringListChangeV1 | undefined {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = [...after].filter((s) => !beforeSet.has(s)).sort();
  const removed = [...before].filter((s) => !afterSet.has(s)).sort();
  if (added.length === 0 && removed.length === 0) {
    return undefined;
  }
  return { kind, added, removed };
}

/**
 * Deterministic before/after diff for builder proposals (M20.5). Ignores JSON key ordering.
 */
export function compareBuilderProposalChanges(
  before: BuilderProposalV1,
  after: BuilderProposalV1,
): BuilderProposalChangesetV1 {
  const registryChanges: BuilderProposalRegistryChangeV1[] = [];
  for (const field of ["key", "name", "description"] as const) {
    const b =
      field === "description"
        ? before.workflowRegistry.description
        : before.workflowRegistry[field];
    const a =
      field === "description"
        ? after.workflowRegistry.description
        : after.workflowRegistry[field];
    if (b !== a) {
      registryChanges.push({ field, before: b, after: a });
    }
  }
  registryChanges.sort((x, y) => x.field.localeCompare(y.field));

  const beforeAgents = agentByRef(before.agents);
  const afterAgents = agentByRef(after.agents);
  const allRefs = [
    ...new Set([...beforeAgents.keys(), ...afterAgents.keys()]),
  ].sort();

  const addedAgents: BuilderProposalAgentAdditionV1[] = [];
  const removedAgents: BuilderProposalAgentRemovalV1[] = [];
  const modifiedAgents: BuilderProposalAgentModificationV1[] = [];

  for (const ref of allRefs) {
    const b = beforeAgents.get(ref);
    const a = afterAgents.get(ref);
    if (b === undefined && a !== undefined) {
      addedAgents.push({
        ref,
        kind: a.kind,
        summary: agentSummary(a),
      });
      continue;
    }
    if (b !== undefined && a === undefined) {
      removedAgents.push({
        ref,
        kind: b.kind,
        summary: agentSummary(b),
      });
      continue;
    }
    if (b === undefined || a === undefined) {
      continue;
    }
    if (b.kind !== a.kind) {
      modifiedAgents.push({ ref, kind: a.kind, fields: ["kind"] });
      continue;
    }
    if (b.kind === "EXISTING" && a.kind === "EXISTING") {
      if (b.agentVersionId !== a.agentVersionId) {
        modifiedAgents.push({
          ref,
          kind: "EXISTING",
          fields: ["agentVersionId"],
        });
      }
      continue;
    }
    if (b.kind === "NEW" && a.kind === "NEW") {
      const fields = newAgentFieldChanges(b, a);
      if (fields.length > 0) {
        modifiedAgents.push({
          ref,
          kind: "NEW",
          fields: fields.sort(),
        });
      }
    }
  }

  const beforeNodes = new Map(
    before.workflow.nodes.map((n) => [n.key, n] as const),
  );
  const afterNodes = new Map(
    after.workflow.nodes.map((n) => [n.key, n] as const),
  );
  const nodeKeys = [
    ...new Set([...beforeNodes.keys(), ...afterNodes.keys()]),
  ].sort();

  const graphNodeChanges: BuilderProposalGraphNodeChangeV1[] = [];
  for (const key of nodeKeys) {
    const b = beforeNodes.get(key);
    const a = afterNodes.get(key);
    if (b === undefined && a !== undefined) {
      graphNodeChanges.push({
        kind: "added",
        nodeKey: key,
        nodeType: a.type,
      });
      continue;
    }
    if (b !== undefined && a === undefined) {
      graphNodeChanges.push({
        kind: "removed",
        nodeKey: key,
        nodeType: b.type,
      });
      continue;
    }
    if (
      b !== undefined &&
      a !== undefined &&
      nodeSignature(b) !== nodeSignature(a)
    ) {
      graphNodeChanges.push({
        kind: "modified",
        nodeKey: key,
        nodeType: a.type,
      });
    }
  }

  const beforeEdges = new Set(
    before.workflow.edges.map((e) => edgeKey(e.from, e.to)),
  );
  const afterEdges = new Set(
    after.workflow.edges.map((e) => edgeKey(e.from, e.to)),
  );
  const graphEdgeChanges: BuilderProposalGraphEdgeChangeV1[] = [];
  for (const e of after.workflow.edges) {
    const k = edgeKey(e.from, e.to);
    if (!beforeEdges.has(k)) {
      graphEdgeChanges.push({ kind: "added", from: e.from, to: e.to });
    }
  }
  for (const e of before.workflow.edges) {
    const k = edgeKey(e.from, e.to);
    if (!afterEdges.has(k)) {
      graphEdgeChanges.push({ kind: "removed", from: e.from, to: e.to });
    }
  }
  graphEdgeChanges.sort((x, y) => {
    const f = x.from.localeCompare(y.from);
    if (f !== 0) {
      return f;
    }
    return x.to.localeCompare(y.to);
  });

  const stringListChanges: BuilderProposalStringListChangeV1[] = [];
  const assumptions = compareStringList(
    "assumptions",
    before.assumptions,
    after.assumptions,
  );
  if (assumptions !== undefined) {
    stringListChanges.push(assumptions);
  }
  const unresolved = compareStringList(
    "unresolvedRequirements",
    before.unresolvedRequirements,
    after.unresolvedRequirements,
  );
  if (unresolved !== undefined) {
    stringListChanges.push(unresolved);
  }

  const noop =
    registryChanges.length === 0 &&
    addedAgents.length === 0 &&
    removedAgents.length === 0 &&
    modifiedAgents.length === 0 &&
    graphNodeChanges.length === 0 &&
    graphEdgeChanges.length === 0 &&
    stringListChanges.length === 0 &&
    jsonValuesEqual(
      before as unknown as JsonValue,
      after as unknown as JsonValue,
    );

  return {
    noop,
    registryChanges,
    addedAgents,
    removedAgents,
    modifiedAgents,
    graphNodeChanges,
    graphEdgeChanges,
    stringListChanges,
  };
}

/** Collect resource ids referenced by a proposal (for catalog pinning). */
export function collectBuilderProposalCatalogResourceIds(
  proposal: BuilderProposalV1,
): {
  readonly agentVersionIds: ReadonlySet<AgentVersionId>;
  readonly modelProfileVersionIds: ReadonlySet<ModelProfileVersionId>;
  readonly toolVersionIds: ReadonlySet<ToolVersionId>;
} {
  const agentVersionIds = new Set<AgentVersionId>();
  const modelProfileVersionIds = new Set<ModelProfileVersionId>();
  const toolVersionIds = new Set<ToolVersionId>();

  for (const spec of proposal.agents) {
    if (spec.kind === "EXISTING") {
      agentVersionIds.add(spec.agentVersionId);
      continue;
    }
    modelProfileVersionIds.add(spec.model.modelProfileVersionId);
    for (const t of spec.tools) {
      toolVersionIds.add(t.toolVersionId);
    }
  }

  return { agentVersionIds, modelProfileVersionIds, toolVersionIds };
}
