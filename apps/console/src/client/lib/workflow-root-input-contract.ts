import type { AgentVersionResource } from "../hooks/use-agents";
import {
  incomingNodeKeys,
  type WorkflowDefinitionNode,
  type WorkflowDefinitionView,
} from "./workflow-definition";

export interface AgentVersionCatalogSnapshot {
  readonly entries: ReadonlyArray<{
    readonly agentId: string;
    readonly versions: readonly AgentVersionResource[];
  }>;
}

export type RootNodeResolution =
  | {
      readonly status: "root_agent";
      readonly node: WorkflowDefinitionNode;
      readonly agentVersionId: string;
    }
  | {
      readonly status: "non_agent_root";
      readonly node: WorkflowDefinitionNode;
    }
  | {
      readonly status: "missing_binding";
      readonly node: WorkflowDefinitionNode;
    }
  | {
      readonly status: "multiple_roots";
      readonly nodes: readonly WorkflowDefinitionNode[];
    }
  | { readonly status: "no_root" }
  | { readonly status: "no_definition" };

export type ResolvedRootInputContract =
  | {
      readonly status: "available";
      readonly nodeKey: string;
      readonly agentVersionId: string;
      readonly agentId: string;
      readonly schema: unknown;
    }
  | {
      readonly status: "schema_unavailable";
      readonly nodeKey: string;
      readonly agentVersionId: string;
      readonly reason: "version_not_found" | "schema_missing";
    }
  | {
      readonly status: "non_agent_root";
      readonly nodeKey: string;
      readonly nodeType: string;
    }
  | { readonly status: "missing_binding"; readonly nodeKey: string }
  | {
      readonly status: "multiple_roots";
      readonly nodeKeys: readonly string[];
    }
  | { readonly status: "no_root" }
  | { readonly status: "no_definition" }
  | { readonly status: "loading" }
  | { readonly status: "catalog_unavailable" };

export function listRootWorkflowNodes(
  definition: WorkflowDefinitionView,
): WorkflowDefinitionNode[] {
  return definition.nodes
    .filter((node) => incomingNodeKeys(definition, node.key).length === 0)
    .slice()
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function resolveRootWorkflowNode(
  definition: WorkflowDefinitionView | undefined,
): RootNodeResolution {
  if (definition === undefined) {
    return { status: "no_definition" };
  }

  const roots = listRootWorkflowNodes(definition);
  if (roots.length === 0) {
    return { status: "no_root" };
  }
  if (roots.length > 1) {
    return { status: "multiple_roots", nodes: roots };
  }

  const node = roots[0]!;
  if (node.type !== "AGENT") {
    return { status: "non_agent_root", node };
  }

  const agentVersionId =
    typeof node.agentVersionId === "string" ? node.agentVersionId.trim() : "";
  if (agentVersionId.length === 0) {
    return { status: "missing_binding", node };
  }

  return { status: "root_agent", node, agentVersionId };
}

export function findAgentVersionInCatalog(
  catalog: AgentVersionCatalogSnapshot | undefined,
  agentVersionId: string,
):
  | { readonly agentId: string; readonly version: AgentVersionResource }
  | undefined {
  if (catalog === undefined) {
    return undefined;
  }

  for (const entry of catalog.entries) {
    const version = entry.versions.find((item) => item.id === agentVersionId);
    if (version !== undefined) {
      return { agentId: entry.agentId, version };
    }
  }

  return undefined;
}

export function extractAgentVersionInputSchema(
  version: AgentVersionResource | undefined,
): unknown | undefined {
  const schema = version?.manifest?.input?.schema;
  return schema === undefined ? undefined : schema;
}

export function resolveRootAgentInputContract(
  definition: WorkflowDefinitionView | undefined,
  catalog: AgentVersionCatalogSnapshot | undefined,
  options: { readonly loading?: boolean; readonly catalogError?: boolean } = {},
): ResolvedRootInputContract {
  const root = resolveRootWorkflowNode(definition);
  if (root.status === "no_definition") {
    return { status: "no_definition" };
  }
  if (root.status === "no_root") {
    return { status: "no_root" };
  }
  if (root.status === "multiple_roots") {
    return {
      status: "multiple_roots",
      nodeKeys: root.nodes.map((node) => node.key),
    };
  }
  if (root.status === "non_agent_root") {
    return {
      status: "non_agent_root",
      nodeKey: root.node.key,
      nodeType: root.node.type,
    };
  }
  if (root.status === "missing_binding") {
    return { status: "missing_binding", nodeKey: root.node.key };
  }

  if (options.loading === true) {
    return { status: "loading" };
  }
  if (options.catalogError === true || catalog === undefined) {
    return { status: "catalog_unavailable" };
  }

  const match = findAgentVersionInCatalog(catalog, root.agentVersionId);
  if (match === undefined) {
    return {
      status: "schema_unavailable",
      nodeKey: root.node.key,
      agentVersionId: root.agentVersionId,
      reason: "version_not_found",
    };
  }

  const schema = extractAgentVersionInputSchema(match.version);
  if (schema === undefined) {
    return {
      status: "schema_unavailable",
      nodeKey: root.node.key,
      agentVersionId: root.agentVersionId,
      reason: "schema_missing",
    };
  }

  return {
    status: "available",
    nodeKey: root.node.key,
    agentVersionId: root.agentVersionId,
    agentId: match.agentId,
    schema,
  };
}

export function isEmptyObjectJsonSchema(schema: unknown): boolean {
  if (!isRecord(schema)) {
    return false;
  }
  if (schema.type !== undefined && schema.type !== "object") {
    return false;
  }
  const required = asStringArray(schema.required);
  if (required.length > 0) {
    return false;
  }
  const properties = isRecord(schema.properties) ? schema.properties : {};
  return Object.keys(properties).length === 0;
}

/**
 * Builds an example only from const/default values and empty-object/array
 * shapes. Required business fields without const or default are never invented.
 */
export function trySafeExampleFromJsonSchema(
  schema: unknown,
): unknown | undefined {
  return buildSafeExample(schema, new Set());
}

function buildSafeExample(
  schema: unknown,
  seen: Set<unknown>,
): unknown | undefined {
  if (!isRecord(schema) || seen.has(schema)) {
    return undefined;
  }
  seen.add(schema);

  if ("const" in schema) {
    return schema.const;
  }
  if ("default" in schema) {
    return schema.default;
  }

  if (schema.type === "array") {
    const minItems = typeof schema.minItems === "number" ? schema.minItems : 0;
    return minItems === 0 ? [] : undefined;
  }

  if (schema.type !== undefined && schema.type !== "object") {
    return undefined;
  }

  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = asStringArray(schema.required);
  const example: Record<string, unknown> = {};

  for (const key of required) {
    const value = buildSafeExample(properties[key], seen);
    if (value === undefined) {
      return undefined;
    }
    example[key] = value;
  }

  return example;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}
