export interface WorkflowDefinitionEdge {
  readonly from: string;
  readonly to: string;
}

export interface WorkflowDefinitionNode {
  readonly key: string;
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface WorkflowDefinitionView {
  readonly schemaVersion: string;
  readonly nodes: readonly WorkflowDefinitionNode[];
  readonly edges: readonly WorkflowDefinitionEdge[];
}

/** View-model adapter for strict V3 definitions from contracts. */
export function asWorkflowDefinitionView(definition: {
  readonly schemaVersion: string;
  readonly nodes: readonly object[];
  readonly edges: readonly WorkflowDefinitionEdge[];
}): WorkflowDefinitionView {
  return definition as WorkflowDefinitionView;
}

export function orderWorkflowNodeKeys(
  definition: WorkflowDefinitionView,
): string[] {
  const nodeKeys = new Set(definition.nodes.map((node) => node.key));
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const key of nodeKeys) {
    inDegree.set(key, 0);
    outgoing.set(key, []);
  }

  for (const edge of definition.edges) {
    if (!nodeKeys.has(edge.from) || !nodeKeys.has(edge.to)) {
      continue;
    }
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  for (const [from, targets] of outgoing) {
    targets.sort((left, right) => left.localeCompare(right));
    outgoing.set(from, targets);
  }

  const ready = [...nodeKeys]
    .filter((key) => (inDegree.get(key) ?? 0) === 0)
    .sort((left, right) => left.localeCompare(right));

  const ordered: string[] = [];
  while (ready.length > 0) {
    const key = ready.shift()!;
    ordered.push(key);
    for (const next of outgoing.get(key) ?? []) {
      const nextDegree = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, nextDegree);
      if (nextDegree === 0) {
        ready.push(next);
        ready.sort((left, right) => left.localeCompare(right));
      }
    }
  }

  if (ordered.length < nodeKeys.size) {
    const remaining = [...nodeKeys]
      .filter((key) => !ordered.includes(key))
      .sort((left, right) => left.localeCompare(right));
    ordered.push(...remaining);
  }

  return ordered;
}

export function incomingNodeKeys(
  definition: WorkflowDefinitionView,
  nodeKey: string,
): string[] {
  return definition.edges
    .filter((edge) => edge.to === nodeKey)
    .map((edge) => edge.from)
    .sort((left, right) => left.localeCompare(right));
}

export function outgoingNodeKeys(
  definition: WorkflowDefinitionView,
  nodeKey: string,
): string[] {
  return definition.edges
    .filter((edge) => edge.from === nodeKey)
    .map((edge) => edge.to)
    .sort((left, right) => left.localeCompare(right));
}

export function workflowEdgeId(from: string, to: string): string {
  return `edge:${from}->${to}`;
}

export function resolveJsonPointerValue(
  pointer: string,
  document: unknown,
): unknown {
  if (!pointer.startsWith("/")) {
    return undefined;
  }
  const segments =
    pointer === "/"
      ? []
      : pointer
          .slice(1)
          .split("/")
          .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));

  let current: unknown = document;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
