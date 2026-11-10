import { ANTHROPIC_UNSUPPORTED_JSON_SCHEMA_CONSTRAINT_KEYS } from "./anthropic-response-json-schema-projection.js";

const FORBIDDEN = new Set<string>(
  ANTHROPIC_UNSUPPORTED_JSON_SCHEMA_CONSTRAINT_KEYS,
);

export interface AnthropicWireSchemaAuditIssue {
  readonly path: string;
  readonly code:
    "FORBIDDEN_KEYWORD" | "OBJECT_MISSING_ADDITIONAL_PROPERTIES_FALSE";
  readonly detail?: string;
}

/** Offline audit for projected provider wire schema (not canonical OSVA schema). */
export function auditAnthropicWireJsonSchema(
  schema: unknown,
  path = "$",
): AnthropicWireSchemaAuditIssue[] {
  const issues: AnthropicWireSchemaAuditIssue[] = [];
  walk(schema, path, issues);
  return issues;
}

function walk(
  node: unknown,
  path: string,
  issues: AnthropicWireSchemaAuditIssue[],
): void {
  if (node === null || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) {
      walk(node[i], `${path}[${i}]`, issues);
    }
    return;
  }

  const record = node as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN.has(key)) {
      issues.push({
        path: `${path}.${key}`,
        code: "FORBIDDEN_KEYWORD",
        detail: key,
      });
    }
  }

  if (record.type === "object" && record.additionalProperties !== false) {
    issues.push({
      path,
      code: "OBJECT_MISSING_ADDITIONAL_PROPERTIES_FALSE",
    });
  }

  for (const [key, value] of Object.entries(record)) {
    if (
      key === "properties" &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      for (const [prop, sub] of Object.entries(
        value as Record<string, unknown>,
      )) {
        walk(sub, `${path}.properties.${prop}`, issues);
      }
    } else if (key === "items") {
      walk(value, `${path}.items`, issues);
    } else if (key === "anyOf" || key === "oneOf" || key === "allOf") {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) {
          walk(value[i], `${path}.${key}[${i}]`, issues);
        }
      }
    } else if (key === "additionalProperties" && typeof value === "object") {
      walk(value, `${path}.additionalProperties`, issues);
    } else if (key === "$defs" || key === "definitions") {
      if (value !== null && typeof value === "object") {
        for (const [def, sub] of Object.entries(
          value as Record<string, unknown>,
        )) {
          walk(sub, `${path}.${key}.${def}`, issues);
        }
      }
    }
  }
}
