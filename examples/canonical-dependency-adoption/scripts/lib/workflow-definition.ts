export interface WorkflowDefinitionNode {
  readonly key: string;
  readonly type: string;
  readonly title?: string;
  readonly description?: string;
  readonly wait?: unknown;
}

export function parseWorkflowDefinitionNodes(
  definition: unknown,
): readonly WorkflowDefinitionNode[] {
  if (
    definition === null ||
    typeof definition !== "object" ||
    Array.isArray(definition)
  ) {
    return [];
  }
  const nodes = (definition as Record<string, unknown>).nodes;
  if (!Array.isArray(nodes)) {
    return [];
  }
  const parsed: WorkflowDefinitionNode[] = [];
  for (const node of nodes) {
    if (node === null || typeof node !== "object" || Array.isArray(node)) {
      continue;
    }
    const record = node as Record<string, unknown>;
    const key = record.key;
    const type = record.type;
    if (typeof key !== "string" || typeof type !== "string") {
      continue;
    }
    parsed.push({
      key,
      type,
      title: typeof record.title === "string" ? record.title : undefined,
      description:
        typeof record.description === "string" ? record.description : undefined,
      wait: record.wait,
    });
  }
  return parsed;
}

export function approvalTitlesFromDefinition(
  definition: unknown,
): Map<string, string> {
  const titles = new Map<string, string>();
  for (const node of parseWorkflowDefinitionNodes(definition)) {
    if (node.title !== undefined && node.title.length > 0) {
      titles.set(node.key, node.title);
    }
  }
  return titles;
}

export function indexDefinitionNodesByKey(
  definition: unknown,
): Map<string, WorkflowDefinitionNode> {
  const map = new Map<string, WorkflowDefinitionNode>();
  for (const node of parseWorkflowDefinitionNodes(definition)) {
    map.set(node.key, node);
  }
  return map;
}

export interface DeliveryWaitPresentation {
  readonly waitKind: string;
  readonly source: string;
  readonly eventType: string;
  readonly correlationKind: string;
  readonly correlationPointer: string;
  readonly correlationValue: string | undefined;
  readonly timeoutMs: number | undefined;
}

function resolveJsonPointer(root: unknown, pointer: string): unknown {
  if (!pointer.startsWith("/")) {
    return undefined;
  }
  const segments = pointer.slice(1).split("/");
  let current: unknown = root;
  for (const segment of segments) {
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function deriveDeliveryWaitPresentation(
  waitConfig: unknown,
  workflowInput: unknown,
): DeliveryWaitPresentation | undefined {
  if (
    waitConfig === null ||
    typeof waitConfig !== "object" ||
    Array.isArray(waitConfig)
  ) {
    return undefined;
  }
  const record = waitConfig as Record<string, unknown>;
  const kind = record.kind;
  const source = record.source;
  const eventType = record.eventType;
  const correlation = record.correlation;
  const timeoutMs = record.timeoutMs;

  if (typeof kind !== "string" || typeof source !== "string") {
    return undefined;
  }
  if (typeof eventType !== "string") {
    return undefined;
  }

  let correlationKind = "unknown";
  let correlationPointer = "";
  let correlationValue: string | undefined;

  if (
    correlation !== null &&
    typeof correlation === "object" &&
    !Array.isArray(correlation)
  ) {
    const corr = correlation as Record<string, unknown>;
    if (typeof corr.kind === "string") {
      correlationKind = corr.kind;
    }
    if (typeof corr.pointer === "string") {
      correlationPointer = corr.pointer;
      const resolved = resolveJsonPointer(workflowInput, corr.pointer);
      if (typeof resolved === "string" && resolved.length > 0) {
        correlationValue = resolved;
      }
    }
  }

  return {
    waitKind: kind,
    source,
    eventType,
    correlationKind,
    correlationPointer,
    correlationValue,
    timeoutMs:
      typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
        ? timeoutMs
        : undefined,
  };
}

export function extractWorkflowRequestFields(input: unknown): {
  readonly requestId: string | undefined;
  readonly packageName: string | undefined;
  readonly useCase: string | undefined;
  readonly constraints: readonly string[] | undefined;
} {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return {
      requestId: undefined,
      packageName: undefined,
      useCase: undefined,
      constraints: undefined,
    };
  }
  const request = (input as Record<string, unknown>).request;
  if (
    request === null ||
    typeof request !== "object" ||
    Array.isArray(request)
  ) {
    return {
      requestId: undefined,
      packageName: undefined,
      useCase: undefined,
      constraints: undefined,
    };
  }
  const record = request as Record<string, unknown>;
  const constraintsRaw = record.constraints;
  let constraints: readonly string[] | undefined;
  if (Array.isArray(constraintsRaw)) {
    constraints = constraintsRaw.filter(
      (item): item is string => typeof item === "string",
    );
  }
  return {
    requestId:
      typeof record.requestId === "string" && record.requestId.length > 0
        ? record.requestId
        : undefined,
    packageName:
      typeof record.packageName === "string" && record.packageName.length > 0
        ? record.packageName
        : undefined,
    useCase:
      typeof record.useCase === "string" && record.useCase.length > 0
        ? record.useCase
        : undefined,
    constraints,
  };
}
