import type {
  ExecutableWorkflowDefinition,
  WorkflowDefinition,
  WorkflowDefinitionEdgeV1,
  WorkflowDefinitionNodeV1,
  WorkflowDefinitionNodeV2,
  WorkflowDefinitionNodeV3,
  WorkflowDefinitionV1,
  WorkflowDefinitionV2,
  WorkflowDefinitionV3,
  WorkflowBranchEqualsValue,
} from "@osva/contracts";
import {
  WORKFLOW_APPROVAL_DESCRIPTION_MAX_LENGTH,
  WORKFLOW_APPROVAL_TITLE_MAX_LENGTH,
  WORKFLOW_EXECUTABLE_NODE_TYPES,
  WORKFLOW_V2_NODE_TYPES,
  WORKFLOW_V3_NODE_TYPES,
  isValidJsonPointer,
  isValidUtcIso8601Instant,
  isWorkflowAgentNode,
  isExecutableWorkflowDefinition,
  isWorkflowDefinitionV1,
  isWorkflowDefinitionV2,
  isWorkflowDefinitionV3,
} from "@osva/contracts";

import {
  InvalidWorkflowDefinitionError,
  WorkflowDefinitionNotExecutableError,
} from "./errors.js";

type DagWorkflowDefinition = WorkflowDefinitionV2 | WorkflowDefinitionV3;
type DagWorkflowNode = WorkflowDefinitionNodeV2 | WorkflowDefinitionNodeV3;

export type WorkflowDefinitionNodeForDefinition<D extends WorkflowDefinition> =
  D extends WorkflowDefinitionV1
    ? WorkflowDefinitionNodeV1
    : D extends WorkflowDefinitionV2
      ? WorkflowDefinitionNodeV2
      : D extends WorkflowDefinitionV3
        ? WorkflowDefinitionNodeV3
        : never;

const EXECUTABLE_NODE_TYPE_SET = new Set<string>(
  WORKFLOW_EXECUTABLE_NODE_TYPES,
);
const V2_NODE_TYPE_SET = new Set<string>(WORKFLOW_V2_NODE_TYPES);
const V3_NODE_TYPE_SET = new Set<string>(WORKFLOW_V3_NODE_TYPES);

export interface WorkflowGraph<
  D extends WorkflowDefinition = WorkflowDefinition,
> {
  readonly definition: D;
  readonly nodesByKey: ReadonlyMap<
    string,
    WorkflowDefinitionNodeForDefinition<D>
  >;
  readonly incoming: ReadonlyMap<string, readonly string[]>;
  readonly outgoing: ReadonlyMap<string, readonly string[]>;
  readonly entryKey: string;
  readonly terminalKey: string;
  readonly sequenceByKey: ReadonlyMap<string, number>;
}

export type ExecutableWorkflowGraph =
  WorkflowGraph<ExecutableWorkflowDefinition>;

export function assertWorkflowDefinition(definition: WorkflowDefinition): void {
  if (isWorkflowDefinitionV1(definition)) {
    assertSequentialWorkflowDefinition(definition);
    return;
  }

  if (isWorkflowDefinitionV2(definition)) {
    assertDagWorkflowDefinition(definition);
    return;
  }

  if (isWorkflowDefinitionV3(definition)) {
    assertDagWorkflowDefinitionV3(definition);
    return;
  }

  throw new InvalidWorkflowDefinitionError(
    `Unsupported workflow definition schemaVersion '${String((definition as WorkflowDefinition).schemaVersion)}'.`,
  );
}

export function assertWorkflowDefinitionExecutable(
  definition: WorkflowDefinition,
): asserts definition is ExecutableWorkflowDefinition {
  const schemaVersion = definition.schemaVersion;
  if (!isExecutableWorkflowDefinition(definition)) {
    throw new WorkflowDefinitionNotExecutableError(schemaVersion);
  }
}

export function assertSequentialWorkflowDefinition(
  definition: WorkflowDefinitionV1,
): void {
  if (definition.schemaVersion !== "1") {
    throw new InvalidWorkflowDefinitionError(
      `Unsupported workflow definition schemaVersion '${String(definition.schemaVersion)}'.`,
    );
  }

  if (!Array.isArray(definition.nodes) || definition.nodes.length === 0) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow definition must contain at least one node.",
    );
  }

  if (!Array.isArray(definition.edges)) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow definition edges must be an array.",
    );
  }

  const nodesByKey = new Map<string, WorkflowDefinitionNodeV1>();
  for (const node of definition.nodes) {
    assertAgentNode(node);
    if (nodesByKey.has(node.key)) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow node key '${node.key}' is duplicated.`,
      );
    }

    nodesByKey.set(node.key, node);
  }

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const key of nodesByKey.keys()) {
    incoming.set(key, []);
    outgoing.set(key, []);
  }

  for (const edge of definition.edges) {
    assertEdge(edge, nodesByKey);
    incoming.get(edge.to)?.push(edge.from);
    outgoing.get(edge.from)?.push(edge.to);
  }

  for (const [key, sources] of incoming) {
    if (sources.length > 1) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow node '${key}' has multiple incoming edges, which Slice 2.1 sequential execution does not allow.`,
      );
    }
  }

  for (const [key, targets] of outgoing) {
    if (targets.length > 1) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow node '${key}' has multiple outgoing edges, which Slice 2.1 sequential execution does not allow.`,
      );
    }
  }

  const entryNodes = definition.nodes.filter(
    (node) => (incoming.get(node.key) ?? []).length === 0,
  );
  const terminalNodes = definition.nodes.filter(
    (node) => (outgoing.get(node.key) ?? []).length === 0,
  );

  if (entryNodes.length !== 1 || entryNodes[0] === undefined) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow definition must have exactly one entry node.",
    );
  }

  if (terminalNodes.length !== 1) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow definition must have exactly one terminal node.",
    );
  }

  const visited = new Set<string>();
  let current: string | undefined = entryNodes[0].key;
  while (current !== undefined) {
    if (visited.has(current)) {
      throw new InvalidWorkflowDefinitionError(
        "Workflow definition contains a cycle.",
      );
    }

    visited.add(current);
    current = outgoing.get(current)?.[0];
  }

  if (visited.size !== definition.nodes.length) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow definition contains a node that is not part of the sequential chain from the entry node.",
    );
  }
}

export function assertDagWorkflowDefinition(
  definition: WorkflowDefinitionV2,
): void {
  assertDagWorkflowDefinitionForSchemaVersion(definition, "2");
}

function assertDagWorkflowDefinitionV3(definition: WorkflowDefinitionV3): void {
  assertDagWorkflowDefinitionForSchemaVersion(definition, "3");
}

function assertDagWorkflowDefinitionForSchemaVersion(
  definition: DagWorkflowDefinition,
  expectedSchemaVersion: "2" | "3",
): void {
  if (definition.schemaVersion !== expectedSchemaVersion) {
    throw new InvalidWorkflowDefinitionError(
      `Unsupported workflow definition schemaVersion '${String(definition.schemaVersion)}'.`,
    );
  }

  if (!Array.isArray(definition.nodes) || definition.nodes.length === 0) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow definition must contain at least one node.",
    );
  }

  if (!Array.isArray(definition.edges)) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow definition edges must be an array.",
    );
  }

  const nodesByKey = new Map<string, DagWorkflowNode>();
  for (const node of definition.nodes) {
    if (expectedSchemaVersion === "2") {
      assertV2Node(node as WorkflowDefinitionNodeV2);
    } else {
      assertV3Node(node as WorkflowDefinitionNodeV3);
    }

    if (nodesByKey.has(node.key)) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow node key '${node.key}' is duplicated.`,
      );
    }

    nodesByKey.set(node.key, node);
  }

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const key of nodesByKey.keys()) {
    incoming.set(key, []);
    outgoing.set(key, []);
  }

  const edgeKeys = new Set<string>();
  for (const edge of definition.edges) {
    assertEdge(edge, nodesByKey);
    const identity = `${edge.from}\0${edge.to}`;
    if (edgeKeys.has(identity)) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow edge '${edge.from}' → '${edge.to}' is duplicated.`,
      );
    }

    edgeKeys.add(identity);
    incoming.get(edge.to)?.push(edge.from);
    outgoing.get(edge.from)?.push(edge.to);
  }

  if (hasCycle(nodesByKey, outgoing)) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow definition contains a cycle.",
    );
  }

  const entryNodes = definition.nodes.filter(
    (node) => (incoming.get(node.key) ?? []).length === 0,
  );
  const terminalNodes = definition.nodes.filter(
    (node) => (outgoing.get(node.key) ?? []).length === 0,
  );

  if (entryNodes.length !== 1 || entryNodes[0] === undefined) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow definition must have exactly one entry node.",
    );
  }

  if (terminalNodes.length !== 1 || terminalNodes[0] === undefined) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow definition must have exactly one terminal node.",
    );
  }

  const entryKey = entryNodes[0].key;
  const terminalKey = terminalNodes[0].key;

  for (const node of definition.nodes) {
    const inCount = incoming.get(node.key)?.length ?? 0;
    const outCount = outgoing.get(node.key)?.length ?? 0;
    assertDagNodeTopology(
      node,
      inCount,
      outCount,
      node.key === entryKey,
      node.key === terminalKey,
      outgoing.get(node.key) ?? [],
    );
  }

  const reachableFromEntry = walkForward(entryKey, outgoing);
  if (reachableFromEntry.size !== definition.nodes.length) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow definition contains a node that is not reachable from the entry node.",
    );
  }

  const canReachTerminal = walkBackward(terminalKey, incoming);
  if (canReachTerminal.size !== definition.nodes.length) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow definition contains a node that cannot reach the terminal node.",
    );
  }
}

export function orderedSequentialNodeKeys(
  definition: WorkflowDefinitionV1,
): readonly string[] {
  assertSequentialWorkflowDefinition(definition);

  const outgoing = new Map<string, string>();
  for (const edge of definition.edges) {
    outgoing.set(edge.from, edge.to);
  }

  const incoming = new Set(definition.edges.map((edge) => edge.to));
  const entry = definition.nodes.find((node) => !incoming.has(node.key));
  if (entry === undefined) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow definition must have exactly one entry node.",
    );
  }

  const keys: string[] = [];
  let current: string | undefined = entry.key;
  while (current !== undefined) {
    keys.push(current);
    current = outgoing.get(current);
  }

  return keys;
}

export function buildWorkflowGraph<D extends WorkflowDefinition>(
  definition: D,
): WorkflowGraph<D> {
  assertWorkflowDefinition(definition);

  const nodesByKey = new Map<string, WorkflowDefinitionNodeForDefinition<D>>();
  const sequenceByKey = new Map<string, number>();
  definition.nodes.forEach((node, index) => {
    nodesByKey.set(node.key, node as WorkflowDefinitionNodeForDefinition<D>);
    sequenceByKey.set(node.key, index + 1);
  });

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const key of nodesByKey.keys()) {
    incoming.set(key, []);
    outgoing.set(key, []);
  }

  for (const edge of definition.edges) {
    incoming.get(edge.to)?.push(edge.from);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const entry = definition.nodes.find(
    (node) => (incoming.get(node.key) ?? []).length === 0,
  );
  const terminal = definition.nodes.find(
    (node) => (outgoing.get(node.key) ?? []).length === 0,
  );
  if (entry === undefined || terminal === undefined) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow definition must have exactly one entry node and one terminal node.",
    );
  }

  return {
    definition,
    nodesByKey,
    incoming,
    outgoing,
    entryKey: entry.key,
    terminalKey: terminal.key,
    sequenceByKey,
  };
}

export function buildExecutableWorkflowGraph(
  definition: ExecutableWorkflowDefinition,
): ExecutableWorkflowGraph {
  return buildWorkflowGraph(definition);
}

export function listAgentNodes(
  definition: WorkflowDefinition,
): ReadonlyArray<WorkflowDefinitionNodeV1 | DagWorkflowNode> {
  return definition.nodes.filter(isWorkflowAgentNode);
}

export function predecessorKeysInDefinitionOrder<D extends WorkflowDefinition>(
  graph: WorkflowGraph<D>,
  nodeKey: string,
): readonly string[] {
  const incoming = [...(graph.incoming.get(nodeKey) ?? [])];
  incoming.sort((left, right) => {
    const leftSequence = graph.sequenceByKey.get(left) ?? 0;
    const rightSequence = graph.sequenceByKey.get(right) ?? 0;
    return leftSequence - rightSequence;
  });
  return incoming;
}

function assertAgentNode(node: WorkflowDefinitionNodeV1): void {
  if (typeof node.key !== "string" || node.key.trim().length === 0) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow node key must be a non-empty string.",
    );
  }

  if (!EXECUTABLE_NODE_TYPE_SET.has(node.type)) {
    throw new InvalidWorkflowDefinitionError(
      `Workflow node '${node.key}' has unsupported type '${String(node.type)}'. Slice 2.1 only supports AGENT nodes.`,
    );
  }

  if (
    typeof node.agentVersionId !== "string" ||
    node.agentVersionId.trim().length === 0
  ) {
    throw new InvalidWorkflowDefinitionError(
      `Workflow node '${node.key}' must bind an immutable agentVersionId.`,
    );
  }
}

function assertV3Node(node: WorkflowDefinitionNodeV3): void {
  if (typeof node.key !== "string" || node.key.trim().length === 0) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow node key must be a non-empty string.",
    );
  }

  if (!V3_NODE_TYPE_SET.has(node.type)) {
    throw new InvalidWorkflowDefinitionError(
      `Workflow node '${node.key}' has unsupported type '${String(node.type)}'. Stage 3.2 V3 supports AGENT, BRANCH, PARALLEL, JOIN, APPROVAL, and WAIT.`,
    );
  }

  if (node.type === "AGENT") {
    if (
      typeof node.agentVersionId !== "string" ||
      node.agentVersionId.trim().length === 0
    ) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow node '${node.key}' must bind an immutable agentVersionId.`,
      );
    }
  }

  if (node.type === "BRANCH") {
    assertBranchNode(node);
  }

  if (node.type === "APPROVAL") {
    assertApprovalNode(node);
  }

  if (node.type === "WAIT") {
    assertWaitNode(node);
  }
}

function assertWaitNode(
  node: Extract<WorkflowDefinitionNodeV3, { type: "WAIT" }>,
): void {
  const wait = node.wait;
  if (wait === null || typeof wait !== "object") {
    throw new InvalidWorkflowDefinitionError(
      `Workflow WAIT '${node.key}' must declare a wait configuration.`,
    );
  }

  if (wait.kind === "DURATION") {
    if (!isPositiveSafeInteger(wait.durationMs)) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow WAIT '${node.key}' durationMs must be a positive safe integer.`,
      );
    }
    return;
  }

  if (wait.kind === "UNTIL") {
    if (
      typeof wait.until !== "string" ||
      !isValidUtcIso8601Instant(wait.until)
    ) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow WAIT '${node.key}' until must be a canonical UTC ISO-8601 instant.`,
      );
    }
    return;
  }

  if (wait.kind !== "EVENT") {
    throw new InvalidWorkflowDefinitionError(
      `Workflow WAIT '${node.key}' has an unsupported wait kind.`,
    );
  }

  if (typeof wait.source !== "string" || wait.source.trim().length === 0) {
    throw new InvalidWorkflowDefinitionError(
      `Workflow WAIT '${node.key}' event source must be a non-empty string.`,
    );
  }

  if (
    typeof wait.eventType !== "string" ||
    wait.eventType.trim().length === 0
  ) {
    throw new InvalidWorkflowDefinitionError(
      `Workflow WAIT '${node.key}' eventType must be a non-empty string.`,
    );
  }

  assertWaitCorrelation(node.key, wait.correlation);

  if (wait.timeoutMs !== undefined && !isPositiveSafeInteger(wait.timeoutMs)) {
    throw new InvalidWorkflowDefinitionError(
      `Workflow WAIT '${node.key}' timeoutMs must be a positive safe integer when present.`,
    );
  }
}

function assertWaitCorrelation(
  nodeKey: string,
  correlation: Extract<
    Extract<WorkflowDefinitionNodeV3, { type: "WAIT" }>["wait"],
    { kind: "EVENT" }
  >["correlation"],
): void {
  if (correlation.kind === "LITERAL") {
    if (
      typeof correlation.value !== "string" ||
      correlation.value.trim().length === 0
    ) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow WAIT '${nodeKey}' correlation literal must be a non-empty string.`,
      );
    }
    return;
  }

  if (correlation.kind !== "INPUT_POINTER") {
    throw new InvalidWorkflowDefinitionError(
      `Workflow WAIT '${nodeKey}' correlation kind is unsupported.`,
    );
  }

  if (!isValidJsonPointer(correlation.pointer)) {
    throw new InvalidWorkflowDefinitionError(
      `Workflow WAIT '${nodeKey}' correlation pointer must be a valid JSON Pointer.`,
    );
  }
}

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    Number.isSafeInteger(value)
  );
}

function assertV2Node(node: WorkflowDefinitionNodeV2): void {
  if (typeof node.key !== "string" || node.key.trim().length === 0) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow node key must be a non-empty string.",
    );
  }

  if (!V2_NODE_TYPE_SET.has(node.type)) {
    throw new InvalidWorkflowDefinitionError(
      `Workflow node '${node.key}' has unsupported type '${String(node.type)}'. Slice 2.3 supports AGENT, BRANCH, PARALLEL, JOIN, and APPROVAL.`,
    );
  }

  if (node.type === "AGENT") {
    if (
      typeof node.agentVersionId !== "string" ||
      node.agentVersionId.trim().length === 0
    ) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow node '${node.key}' must bind an immutable agentVersionId.`,
      );
    }
  }

  if (node.type === "BRANCH") {
    assertBranchNode(node);
  }

  if (node.type === "APPROVAL") {
    assertApprovalNode(node);
  }
}

function assertBranchNode(
  node: Extract<WorkflowDefinitionNodeV2, { type: "BRANCH" }>,
): void {
  if (!isValidJsonPointer(node.selector)) {
    throw new InvalidWorkflowDefinitionError(
      `Workflow BRANCH '${node.key}' has an invalid JSON Pointer selector.`,
    );
  }

  if (
    typeof node.defaultTo !== "string" ||
    node.defaultTo.trim().length === 0
  ) {
    throw new InvalidWorkflowDefinitionError(
      `Workflow BRANCH '${node.key}' must declare a defaultTo path.`,
    );
  }

  if (!Array.isArray(node.cases) || node.cases.length === 0) {
    throw new InvalidWorkflowDefinitionError(
      `Workflow BRANCH '${node.key}' must declare at least one case.`,
    );
  }

  const seenEquals = new Set<string>();
  for (const branchCase of node.cases) {
    if (!isBranchEqualsValue(branchCase.equals)) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow BRANCH '${node.key}' has an illegal case value type.`,
      );
    }

    if (
      typeof branchCase.to !== "string" ||
      branchCase.to.trim().length === 0
    ) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow BRANCH '${node.key}' case target must be a non-empty string.`,
      );
    }

    const encoded = encodeBranchEquals(branchCase.equals);
    if (seenEquals.has(encoded)) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow BRANCH '${node.key}' has duplicate exact-match cases.`,
      );
    }

    seenEquals.add(encoded);
  }
}

function assertApprovalNode(
  node: Extract<WorkflowDefinitionNodeV2, { type: "APPROVAL" }>,
): void {
  if (
    typeof node.title !== "string" ||
    node.title.trim().length === 0 ||
    node.title.length > WORKFLOW_APPROVAL_TITLE_MAX_LENGTH
  ) {
    throw new InvalidWorkflowDefinitionError(
      `Workflow APPROVAL '${node.key}' must declare a non-empty title of at most ${String(WORKFLOW_APPROVAL_TITLE_MAX_LENGTH)} characters.`,
    );
  }

  if (node.description !== undefined) {
    if (
      typeof node.description !== "string" ||
      node.description.trim().length === 0 ||
      node.description.length > WORKFLOW_APPROVAL_DESCRIPTION_MAX_LENGTH
    ) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow APPROVAL '${node.key}' description must be a non-empty string of at most ${String(WORKFLOW_APPROVAL_DESCRIPTION_MAX_LENGTH)} characters.`,
      );
    }
  }
}

function assertDagNodeTopology(
  node: DagWorkflowNode,
  inCount: number,
  outCount: number,
  isEntry: boolean,
  isTerminal: boolean,
  outgoingTargets: readonly string[],
): void {
  if (
    node.type === "AGENT" ||
    node.type === "APPROVAL" ||
    node.type === "WAIT"
  ) {
    if (isEntry ? inCount !== 0 : inCount !== 1) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow ${node.type} '${node.key}' cannot have implicit fan-in.`,
      );
    }

    if (isTerminal ? outCount !== 0 : outCount !== 1) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow ${node.type} '${node.key}' cannot have implicit fan-out.`,
      );
    }

    return;
  }

  if (node.type === "PARALLEL") {
    if (inCount > 1) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow PARALLEL '${node.key}' cannot have implicit fan-in.`,
      );
    }

    if (outCount < 2) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow PARALLEL '${node.key}' must have at least two outgoing edges.`,
      );
    }

    return;
  }

  if (node.type === "JOIN") {
    if (inCount < 2) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow JOIN '${node.key}' must have at least two incoming edges.`,
      );
    }

    if (outCount > 1) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow JOIN '${node.key}' cannot have implicit fan-out.`,
      );
    }

    return;
  }

  if (inCount > 1) {
    throw new InvalidWorkflowDefinitionError(
      `Workflow BRANCH '${node.key}' cannot have implicit fan-in.`,
    );
  }

  if (outCount < 2) {
    throw new InvalidWorkflowDefinitionError(
      `Workflow BRANCH '${node.key}' must have at least two outgoing edges.`,
    );
  }

  const outgoingSet = new Set(outgoingTargets);
  if (!outgoingSet.has(node.defaultTo)) {
    throw new InvalidWorkflowDefinitionError(
      `Workflow BRANCH '${node.key}' defaultTo '${node.defaultTo}' is not an outgoing edge.`,
    );
  }

  for (const branchCase of node.cases) {
    if (!outgoingSet.has(branchCase.to)) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow BRANCH '${node.key}' case target '${branchCase.to}' is not an outgoing edge.`,
      );
    }
  }

  for (const target of outgoingTargets) {
    const covered =
      target === node.defaultTo ||
      node.cases.some((branchCase) => branchCase.to === target);
    if (!covered) {
      throw new InvalidWorkflowDefinitionError(
        `Workflow BRANCH '${node.key}' outgoing edge '${target}' is not a case or default target.`,
      );
    }
  }
}

function assertEdge(
  edge: WorkflowDefinitionEdgeV1,
  nodesByKey: ReadonlyMap<string, { readonly key: string }>,
): void {
  if (typeof edge.from !== "string" || edge.from.trim().length === 0) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow edge.from must be a non-empty string.",
    );
  }

  if (typeof edge.to !== "string" || edge.to.trim().length === 0) {
    throw new InvalidWorkflowDefinitionError(
      "Workflow edge.to must be a non-empty string.",
    );
  }

  if (!nodesByKey.has(edge.from) || !nodesByKey.has(edge.to)) {
    throw new InvalidWorkflowDefinitionError(
      `Workflow edge '${edge.from}' → '${edge.to}' references a node that does not exist.`,
    );
  }
}

function hasCycle(
  nodesByKey: ReadonlyMap<string, DagWorkflowNode>,
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

  for (const key of nodesByKey.keys()) {
    if (visit(key)) {
      return true;
    }
  }

  return false;
}

function walkForward(
  start: string,
  outgoing: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const visited = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || visited.has(current)) {
      continue;
    }

    visited.add(current);
    stack.push(...(outgoing.get(current) ?? []));
  }

  return visited;
}

function walkBackward(
  start: string,
  incoming: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const visited = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || visited.has(current)) {
      continue;
    }

    visited.add(current);
    stack.push(...(incoming.get(current) ?? []));
  }

  return visited;
}

function isBranchEqualsValue(
  value: unknown,
): value is WorkflowBranchEqualsValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }

  return typeof value === "number" && Number.isFinite(value);
}

function encodeBranchEquals(value: WorkflowBranchEqualsValue): string {
  return JSON.stringify(value);
}
