import type {
  WorkflowDefinitionNodeV3,
  WorkflowDefinitionV3,
} from "@osva-ai/contracts";
import {
  isValidJsonPointer,
  isValidUtcIso8601Instant,
} from "@osva-ai/contracts";
import { workflowDefinitionSchema } from "@osva-ai/contracts/schemas";
import {
  InvalidWorkflowDefinitionError,
  assertWorkflowDefinition,
} from "@osva/domain/workflow-definition";

import type { WorkflowBuilderDraft } from "./workflow-builder-draft";

export type WorkflowBuilderValidationSeverity = "error" | "warning";
export type WorkflowBuilderValidationScope =
  "registry" | "graph" | "node" | "edge";

export interface WorkflowBuilderValidationEdgeRef {
  readonly from: string;
  readonly to: string;
}

export interface WorkflowBuilderValidationIssue {
  readonly id: string;
  readonly severity: WorkflowBuilderValidationSeverity;
  readonly scope: WorkflowBuilderValidationScope;
  readonly code: string;
  readonly message: string;
  readonly action: string;
  readonly nodeKey?: string;
  readonly edge?: WorkflowBuilderValidationEdgeRef;
  readonly relatedNodeKeys?: readonly string[];
}

export interface WorkflowBuilderValidationReport {
  readonly issues: readonly WorkflowBuilderValidationIssue[];
  readonly errorCount: number;
  readonly warningCount: number;
  readonly canPublish: boolean;
}

function issue(
  partial: Omit<WorkflowBuilderValidationIssue, "severity"> & {
    readonly severity?: WorkflowBuilderValidationSeverity;
  },
): WorkflowBuilderValidationIssue {
  return {
    severity: "error",
    ...partial,
  };
}

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    Number.isSafeInteger(value)
  );
}

function collectRegistryIssues(
  draft: WorkflowBuilderDraft,
): WorkflowBuilderValidationIssue[] {
  const issues: WorkflowBuilderValidationIssue[] = [];
  if (draft.registry.key.trim().length === 0) {
    issues.push(
      issue({
        id: "registry:key",
        scope: "registry",
        code: "registry_key_required",
        message: "Workflow key is required.",
        action: "Enter a workflow key in the registry section.",
      }),
    );
  }
  if (draft.registry.name.trim().length === 0) {
    issues.push(
      issue({
        id: "registry:name",
        scope: "registry",
        code: "registry_name_required",
        message: "Workflow name is required.",
        action: "Enter a workflow name in the registry section.",
      }),
    );
  }
  return issues;
}

function collectNodeConfigIssues(
  node: WorkflowDefinitionNodeV3,
): WorkflowBuilderValidationIssue[] {
  const issues: WorkflowBuilderValidationIssue[] = [];
  if (node.type === "AGENT" && node.agentVersionId.trim().length === 0) {
    issues.push(
      issue({
        id: `node:${node.key}:agent-version`,
        scope: "node",
        code: "agent_version_required",
        message: `AGENT node ${node.key} has no agent version.`,
        action: "Select an immutable agent version for this node.",
        nodeKey: node.key,
      }),
    );
  }
  if (node.type === "APPROVAL" && node.title.trim().length === 0) {
    issues.push(
      issue({
        id: `node:${node.key}:approval-title`,
        scope: "node",
        code: "approval_title_required",
        message: `APPROVAL node ${node.key} needs a title.`,
        action: "Enter a non-empty approval title.",
        nodeKey: node.key,
      }),
    );
  }
  if (node.type === "WAIT") {
    issues.push(...collectWaitIssues(node));
  }
  if (node.type === "BRANCH") {
    if (!isValidJsonPointer(node.selector)) {
      issues.push(
        issue({
          id: `node:${node.key}:branch-selector`,
          scope: "node",
          code: "branch_selector_invalid",
          message: `BRANCH node ${node.key} has an invalid JSON Pointer selector.`,
          action: "Set selector to a valid JSON Pointer such as /status.",
          nodeKey: node.key,
        }),
      );
    }
    if (node.cases.length === 0) {
      issues.push(
        issue({
          id: `node:${node.key}:branch-cases`,
          scope: "node",
          code: "branch_cases_required",
          message: `BRANCH node ${node.key} must declare at least one case.`,
          action: "Add a case after connecting outgoing edges.",
          nodeKey: node.key,
        }),
      );
    }
    if (node.defaultTo.trim().length === 0) {
      issues.push(
        issue({
          id: `node:${node.key}:branch-default`,
          scope: "node",
          code: "branch_default_required",
          message: `BRANCH node ${node.key} must declare a default target.`,
          action: "Choose defaultTo from an outgoing edge.",
          nodeKey: node.key,
        }),
      );
    }
  }
  return issues;
}

function collectWaitIssues(
  node: Extract<WorkflowDefinitionNodeV3, { type: "WAIT" }>,
): WorkflowBuilderValidationIssue[] {
  const wait = node.wait;
  if (wait.kind === "DURATION" && !isPositiveSafeInteger(wait.durationMs)) {
    return [
      issue({
        id: `node:${node.key}:wait-duration`,
        scope: "node",
        code: "wait_duration_invalid",
        message: `WAIT node ${node.key} durationMs must be a positive integer.`,
        action: "Enter a positive duration in milliseconds.",
        nodeKey: node.key,
      }),
    ];
  }
  if (wait.kind === "UNTIL" && !isValidUtcIso8601Instant(wait.until)) {
    return [
      issue({
        id: `node:${node.key}:wait-until`,
        scope: "node",
        code: "wait_until_invalid",
        message: `WAIT node ${node.key} until must be a UTC ISO-8601 instant.`,
        action: "Use a canonical timestamp such as 2026-01-01T00:00:00.000Z.",
        nodeKey: node.key,
      }),
    ];
  }
  if (wait.kind === "EVENT") {
    const issues: WorkflowBuilderValidationIssue[] = [];
    if (wait.source.trim().length === 0) {
      issues.push(
        issue({
          id: `node:${node.key}:wait-source`,
          scope: "node",
          code: "wait_event_source_required",
          message: `WAIT node ${node.key} event source is required.`,
          action: "Enter a non-empty event source.",
          nodeKey: node.key,
        }),
      );
    }
    if (wait.eventType.trim().length === 0) {
      issues.push(
        issue({
          id: `node:${node.key}:wait-event-type`,
          scope: "node",
          code: "wait_event_type_required",
          message: `WAIT node ${node.key} eventType is required.`,
          action: "Enter a non-empty event type.",
          nodeKey: node.key,
        }),
      );
    }
    if (
      wait.correlation.kind === "LITERAL" &&
      wait.correlation.value.trim().length === 0
    ) {
      issues.push(
        issue({
          id: `node:${node.key}:wait-correlation`,
          scope: "node",
          code: "wait_correlation_required",
          message: `WAIT node ${node.key} correlation value is required.`,
          action: "Enter a non-empty correlation literal.",
          nodeKey: node.key,
        }),
      );
    }
    if (
      wait.correlation.kind === "INPUT_POINTER" &&
      !isValidJsonPointer(wait.correlation.pointer)
    ) {
      issues.push(
        issue({
          id: `node:${node.key}:wait-pointer`,
          scope: "node",
          code: "wait_correlation_pointer_invalid",
          message: `WAIT node ${node.key} correlation pointer is invalid.`,
          action: "Use a valid JSON Pointer such as /orderId.",
          nodeKey: node.key,
        }),
      );
    }
    return issues;
  }
  return [];
}

function collectGraphGuidanceIssues(
  definition: WorkflowDefinitionV3,
): WorkflowBuilderValidationIssue[] {
  const issues: WorkflowBuilderValidationIssue[] = [];
  if (definition.nodes.length === 0) {
    issues.push(
      issue({
        id: "graph:empty",
        scope: "graph",
        code: "graph_empty",
        message: "Add at least one workflow node.",
        action: "Use the palette to add a node.",
      }),
    );
    return issues;
  }

  const seenKeys = new Set<string>();
  const nodeKeys = new Set<string>();
  for (const node of definition.nodes) {
    if (seenKeys.has(node.key)) {
      issues.push(
        issue({
          id: `node:${node.key}:duplicate`,
          scope: "node",
          code: "node_key_duplicate",
          message: `Node key ${node.key} is duplicated.`,
          action: "Remove the duplicate node.",
          nodeKey: node.key,
        }),
      );
    }
    seenKeys.add(node.key);
    nodeKeys.add(node.key);
    issues.push(...collectNodeConfigIssues(node));
  }

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const key of nodeKeys) {
    incoming.set(key, []);
    outgoing.set(key, []);
  }

  const edgeSeen = new Set<string>();
  for (const edge of definition.edges) {
    if (edge.from === edge.to) {
      issues.push(
        issue({
          id: `edge:${edge.from}->${edge.to}:loop`,
          scope: "edge",
          code: "edge_self_loop",
          message: `Edge ${edge.from} → ${edge.to} is a self-loop.`,
          action: "Remove the self-loop.",
          edge,
        }),
      );
    }
    if (!nodeKeys.has(edge.from) || !nodeKeys.has(edge.to)) {
      issues.push(
        issue({
          id: `edge:${edge.from}->${edge.to}:dangling`,
          scope: "edge",
          code: "edge_unknown_node",
          message: `Edge ${edge.from} → ${edge.to} references a missing node.`,
          action: "Reconnect or remove the edge.",
          edge,
        }),
      );
      continue;
    }
    const identity = `${edge.from}\0${edge.to}`;
    if (edgeSeen.has(identity)) {
      issues.push(
        issue({
          id: `edge:${edge.from}->${edge.to}:duplicate`,
          scope: "edge",
          code: "edge_duplicate",
          message: `Edge ${edge.from} → ${edge.to} is duplicated.`,
          action: "Remove the extra edge.",
          edge,
        }),
      );
      continue;
    }
    edgeSeen.add(identity);
    incoming.get(edge.to)?.push(edge.from);
    outgoing.get(edge.from)?.push(edge.to);
  }

  for (const node of definition.nodes) {
    const inCount = incoming.get(node.key)?.length ?? 0;
    const outCount = outgoing.get(node.key)?.length ?? 0;
    const targets = outgoing.get(node.key) ?? [];
    issues.push(...collectDegreeIssues(node, inCount, outCount, targets));
  }

  const entries = definition.nodes
    .filter((node) => (incoming.get(node.key) ?? []).length === 0)
    .map((node) => node.key);
  const terminals = definition.nodes
    .filter((node) => (outgoing.get(node.key) ?? []).length === 0)
    .map((node) => node.key);

  if (entries.length !== 1) {
    issues.push(
      issue({
        id: "graph:entry",
        scope: "graph",
        code: "graph_entry_count",
        message:
          entries.length === 0
            ? "The graph has no entry node."
            : "The graph must have exactly one entry node.",
        action: "Connect nodes so a single node has no incoming edges.",
        relatedNodeKeys: entries,
      }),
    );
  }
  if (terminals.length !== 1) {
    issues.push(
      issue({
        id: "graph:terminal",
        scope: "graph",
        code: "graph_terminal_count",
        message:
          terminals.length === 0
            ? "The graph has no terminal node."
            : "The graph must have exactly one terminal node.",
        action: "Connect nodes so a single node has no outgoing edges.",
        relatedNodeKeys: terminals,
      }),
    );
  }

  if (hasCycle(nodeKeys, outgoing)) {
    issues.push(
      issue({
        id: "graph:cycle",
        scope: "graph",
        code: "graph_cycle",
        message: "The graph contains a cycle.",
        action: "Remove an edge that closes the loop.",
      }),
    );
  }

  if (entries.length === 1 && entries[0] !== undefined) {
    const reachable = walk(entries[0], outgoing);
    for (const node of definition.nodes) {
      if (!reachable.has(node.key)) {
        issues.push(
          issue({
            id: `node:${node.key}:unreachable`,
            scope: "node",
            code: "node_unreachable",
            message: `Node ${node.key} is not reachable from the entry node.`,
            action: "Connect this node from the main path.",
            nodeKey: node.key,
          }),
        );
      }
    }
  }

  if (terminals.length === 1 && terminals[0] !== undefined) {
    const canReach = walk(terminals[0], incoming);
    for (const node of definition.nodes) {
      if (!canReach.has(node.key)) {
        issues.push(
          issue({
            id: `node:${node.key}:no-terminal`,
            scope: "node",
            code: "node_cannot_reach_terminal",
            message: `Node ${node.key} cannot reach the terminal node.`,
            action: "Connect this node onward to the terminal.",
            nodeKey: node.key,
          }),
        );
      }
    }
  }

  return issues;
}

function collectDegreeIssues(
  node: WorkflowDefinitionNodeV3,
  inCount: number,
  outCount: number,
  outgoingTargets: readonly string[],
): WorkflowBuilderValidationIssue[] {
  const issues: WorkflowBuilderValidationIssue[] = [];
  if (
    node.type === "AGENT" ||
    node.type === "APPROVAL" ||
    node.type === "WAIT"
  ) {
    if (inCount > 1) {
      issues.push(
        issue({
          id: `node:${node.key}:fan-in`,
          scope: "node",
          code: "node_implicit_fan_in",
          message: `${node.type} node ${node.key} cannot have implicit fan-in.`,
          action: "Route multiple predecessors through a JOIN.",
          nodeKey: node.key,
        }),
      );
    }
    if (outCount > 1) {
      issues.push(
        issue({
          id: `node:${node.key}:fan-out`,
          scope: "node",
          code: "node_implicit_fan_out",
          message: `${node.type} node ${node.key} cannot have implicit fan-out.`,
          action: "Use BRANCH or PARALLEL for multiple successors.",
          nodeKey: node.key,
        }),
      );
    }
    return issues;
  }

  if (node.type === "PARALLEL") {
    if (inCount > 1) {
      issues.push(
        issue({
          id: `node:${node.key}:parallel-fan-in`,
          scope: "node",
          code: "parallel_implicit_fan_in",
          message: `PARALLEL node ${node.key} cannot have implicit fan-in.`,
          action: "Give PARALLEL at most one incoming edge.",
          nodeKey: node.key,
        }),
      );
    }
    if (outCount < 2) {
      issues.push(
        issue({
          id: `node:${node.key}:parallel-out`,
          scope: "node",
          code: "parallel_out_degree",
          message: `PARALLEL node ${node.key} needs at least two outgoing edges.`,
          action: "Connect at least two successors.",
          nodeKey: node.key,
        }),
      );
    }
    return issues;
  }

  if (node.type === "JOIN") {
    if (inCount < 2) {
      issues.push(
        issue({
          id: `node:${node.key}:join-in`,
          scope: "node",
          code: "join_in_degree",
          message: `JOIN node ${node.key} needs at least two incoming edges.`,
          action: "Connect at least two predecessors.",
          nodeKey: node.key,
        }),
      );
    }
    if (outCount > 1) {
      issues.push(
        issue({
          id: `node:${node.key}:join-out`,
          scope: "node",
          code: "join_implicit_fan_out",
          message: `JOIN node ${node.key} cannot have implicit fan-out.`,
          action: "Give JOIN at most one outgoing edge.",
          nodeKey: node.key,
        }),
      );
    }
    return issues;
  }

  if (inCount > 1) {
    issues.push(
      issue({
        id: `node:${node.key}:branch-fan-in`,
        scope: "node",
        code: "branch_implicit_fan_in",
        message: `BRANCH node ${node.key} cannot have implicit fan-in.`,
        action: "Give BRANCH at most one incoming edge.",
        nodeKey: node.key,
      }),
    );
  }
  if (outCount < 2) {
    issues.push(
      issue({
        id: `node:${node.key}:branch-out`,
        scope: "node",
        code: "branch_out_degree",
        message: `BRANCH node ${node.key} needs at least two outgoing edges.`,
        action: "Connect case and default targets.",
        nodeKey: node.key,
      }),
    );
  }

  const outgoingSet = new Set(outgoingTargets);
  if (node.defaultTo.trim().length > 0 && !outgoingSet.has(node.defaultTo)) {
    issues.push(
      issue({
        id: `node:${node.key}:branch-default-edge`,
        scope: "node",
        code: "branch_default_not_outgoing",
        message: `BRANCH node ${node.key} defaultTo is not an outgoing edge.`,
        action: "Connect an edge to the default target or pick another target.",
        nodeKey: node.key,
      }),
    );
  }
  for (const branchCase of node.cases) {
    if (branchCase.to.trim().length === 0 || !outgoingSet.has(branchCase.to)) {
      issues.push(
        issue({
          id: `node:${node.key}:branch-case-${branchCase.to || "empty"}`,
          scope: "node",
          code: "branch_case_not_outgoing",
          message: `BRANCH node ${node.key} has a case target that is not outgoing.`,
          action: "Connect an edge to the case target or change the case.",
          nodeKey: node.key,
        }),
      );
    }
  }
  for (const target of outgoingTargets) {
    const covered =
      target === node.defaultTo ||
      node.cases.some((branchCase) => branchCase.to === target);
    if (!covered) {
      issues.push(
        issue({
          id: `edge:${node.key}->${target}:unlabeled`,
          scope: "edge",
          code: "branch_edge_unlabeled",
          message: `BRANCH edge ${node.key} → ${target} is not a case or default.`,
          action: "Assign this target as a case or defaultTo.",
          nodeKey: node.key,
          edge: { from: node.key, to: target },
        }),
      );
    }
  }
  return issues;
}

function hasCycle(
  nodeKeys: ReadonlySet<string>,
  outgoing: ReadonlyMap<string, readonly string[]>,
): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): boolean => {
    if (visited.has(key)) {
      return false;
    }
    if (visiting.has(key)) {
      return true;
    }
    visiting.add(key);
    for (const next of outgoing.get(key) ?? []) {
      if (visit(next)) {
        return true;
      }
    }
    visiting.delete(key);
    visited.add(key);
    return false;
  };
  for (const key of nodeKeys) {
    if (visit(key)) {
      return true;
    }
  }
  return false;
}

function walk(
  start: string,
  adjacency: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const visited = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || visited.has(current)) {
      continue;
    }
    visited.add(current);
    stack.push(...(adjacency.get(current) ?? []));
  }
  return visited;
}

function summarizeReport(
  issues: readonly WorkflowBuilderValidationIssue[],
): WorkflowBuilderValidationReport {
  const errorCount = issues.filter((item) => item.severity === "error").length;
  const warningCount = issues.filter(
    (item) => item.severity === "warning",
  ).length;
  return {
    issues,
    errorCount,
    warningCount,
    canPublish: errorCount === 0,
  };
}

/**
 * Live editor guidance. Does not mutate the draft. Does not replace domain validation.
 */
export function analyzeWorkflowBuilderDraft(
  draft: WorkflowBuilderDraft,
): WorkflowBuilderValidationReport {
  return summarizeReport([
    ...collectRegistryIssues(draft),
    ...collectGraphGuidanceIssues(draft.definition),
  ]);
}

export function issuesForNode(
  report: WorkflowBuilderValidationReport,
  nodeKey: string,
): WorkflowBuilderValidationIssue[] {
  return report.issues.filter(
    (item) =>
      item.nodeKey === nodeKey || item.relatedNodeKeys?.includes(nodeKey),
  );
}

export function errorNodeKeys(
  report: WorkflowBuilderValidationReport,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const item of report.issues) {
    if (item.severity !== "error") {
      continue;
    }
    if (item.nodeKey !== undefined) {
      keys.add(item.nodeKey);
    }
    for (const related of item.relatedNodeKeys ?? []) {
      keys.add(related);
    }
  }
  return keys;
}

export function summarizeDefinition(definition: WorkflowDefinitionV3): {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly nodeTypes: Readonly<Record<string, number>>;
  readonly agentBindings: ReadonlyArray<{
    readonly nodeKey: string;
    readonly agentVersionId: string;
  }>;
} {
  const nodeTypes: Record<string, number> = {};
  const agentBindings: Array<{
    nodeKey: string;
    agentVersionId: string;
  }> = [];
  for (const node of definition.nodes) {
    nodeTypes[node.type] = (nodeTypes[node.type] ?? 0) + 1;
    if (node.type === "AGENT") {
      agentBindings.push({
        nodeKey: node.key,
        agentVersionId: node.agentVersionId,
      });
    }
  }
  return {
    nodeCount: definition.nodes.length,
    edgeCount: definition.edges.length,
    nodeTypes,
    agentBindings,
  };
}

export function applyCanonicalPublishGate(
  draft: WorkflowBuilderDraft,
  guidance: WorkflowBuilderValidationReport,
): WorkflowBuilderValidationReport {
  const definition: WorkflowDefinitionV3 = {
    schemaVersion: "3",
    nodes: draft.definition.nodes,
    edges: draft.definition.edges,
  };
  if (JSON.stringify(definition).includes("layoutByNodeKey")) {
    throw new Error("Layout must not appear in persisted workflow definition.");
  }
  const extra: WorkflowBuilderValidationIssue[] = [];
  const parsed = workflowDefinitionSchema.safeParse(definition);
  if (!parsed.success) {
    if (guidance.errorCount === 0) {
      extra.push(
        issue({
          id: "gate:zod",
          scope: "graph",
          code: "definition_shape_invalid",
          message:
            "Workflow definition shape is invalid. Check node configuration.",
          action: "Fix highlighted node fields, then review again.",
        }),
      );
    }
  } else if (parsed.data.schemaVersion !== "3") {
    extra.push(
      issue({
        id: "gate:schema",
        scope: "graph",
        code: "schema_version_invalid",
        message: "Workflow builder requires schema version 3.",
        action: "Rebuild the draft as a V3 definition.",
      }),
    );
  } else {
    try {
      assertWorkflowDefinition(parsed.data);
    } catch (error) {
      if (!(error instanceof InvalidWorkflowDefinitionError)) {
        throw error;
      }
      if (guidance.errorCount === 0) {
        extra.push(
          issue({
            id: "gate:domain",
            scope: "graph",
            code: "domain_invalid",
            message: error.message,
            action: "Correct the graph using the validation details above.",
          }),
        );
      }
    }
  }
  return summarizeReport([...guidance.issues, ...extra]);
}
