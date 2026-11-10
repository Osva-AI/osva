/** Anthropic structured-output documented complexity budgets (per request). */
export const ANTHROPIC_STRUCTURED_OUTPUT_OPTIONAL_PARAM_LIMIT = 24;
export const ANTHROPIC_STRUCTURED_OUTPUT_UNION_PARAM_LIMIT = 16;

export interface AnthropicWireSchemaComplexityMetrics {
  readonly objectNodes: number;
  readonly properties: number;
  readonly optionalParameters: number;
  readonly unionParameters: number;
  readonly anyOfNodes: number;
  readonly allOfNodes: number;
  readonly oneOfNodes: number;
  readonly typeArrayNodes: number;
  readonly maxNestingDepth: number;
  readonly serializedSchemaBytes: number;
  readonly refCount: number;
  readonly constCount: number;
  readonly patternCount: number;
  readonly unsupportedConstraintHits: number;
}

export function measureAnthropicWireSchemaComplexity(
  schema: unknown,
): AnthropicWireSchemaComplexityMetrics {
  let objectNodes = 0;
  let properties = 0;
  let optionalParameters = 0;
  let unionParameters = 0;
  let anyOfNodes = 0;
  let allOfNodes = 0;
  let oneOfNodes = 0;
  let typeArrayNodes = 0;
  let maxNestingDepth = 0;
  let refCount = 0;
  let constCount = 0;
  let patternCount = 0;
  let unsupportedConstraintHits = 0;

  const walk = (node: unknown, depth: number, path: string): void => {
    if (depth > maxNestingDepth) {
      maxNestingDepth = depth;
    }
    if (node === null || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        walk(node[i], depth + 1, `${path}[${i}]`);
      }
      return;
    }

    const record = node as Record<string, unknown>;
    if (record.type === "object" || record.properties !== undefined) {
      objectNodes += 1;
    }
    if (typeof record.$ref === "string") {
      refCount += 1;
    }
    if (record.const !== undefined) {
      constCount += 1;
    }
    if (record.pattern !== undefined) {
      patternCount += 1;
    }
    if (Array.isArray(record.type)) {
      unionParameters += 1;
      typeArrayNodes += 1;
    }
    if (record.anyOf !== undefined) {
      unionParameters += 1;
      anyOfNodes += 1;
    }
    if (record.allOf !== undefined) {
      unionParameters += 1;
      allOfNodes += 1;
    }
    if (record.oneOf !== undefined) {
      unionParameters += 1;
      oneOfNodes += 1;
    }

    for (const key of [
      "minimum",
      "maximum",
      "exclusiveMinimum",
      "exclusiveMaximum",
      "multipleOf",
      "minLength",
      "maxLength",
      "maxItems",
      "patternProperties",
    ] as const) {
      if (record[key] !== undefined) {
        unsupportedConstraintHits += 1;
      }
    }
    if (
      record.minItems !== undefined &&
      record.minItems !== 0 &&
      record.minItems !== 1
    ) {
      unsupportedConstraintHits += 1;
    }

    if (
      record.properties !== null &&
      typeof record.properties === "object" &&
      !Array.isArray(record.properties)
    ) {
      const required = new Set(
        Array.isArray(record.required) ? record.required : [],
      );
      for (const [key, value] of Object.entries(
        record.properties as Record<string, unknown>,
      )) {
        properties += 1;
        if (!required.has(key)) {
          optionalParameters += 1;
        }
        walk(value, depth + 1, `${path}.properties.${key}`);
      }
    }

    if (record.items !== undefined) {
      walk(record.items, depth + 1, `${path}.items`);
    }
    if (
      record.additionalProperties !== null &&
      typeof record.additionalProperties === "object"
    ) {
      walk(
        record.additionalProperties,
        depth + 1,
        `${path}.additionalProperties`,
      );
    }

    for (const unionKey of ["anyOf", "allOf", "oneOf"] as const) {
      const variants = record[unionKey];
      if (Array.isArray(variants)) {
        for (let i = 0; i < variants.length; i += 1) {
          walk(variants[i], depth + 1, `${path}.${unionKey}[${i}]`);
        }
      }
    }

    for (const defsKey of ["$defs", "definitions"] as const) {
      const defs = record[defsKey];
      if (defs !== null && typeof defs === "object" && !Array.isArray(defs)) {
        for (const [defName, defSchema] of Object.entries(
          defs as Record<string, unknown>,
        )) {
          walk(defSchema, depth + 1, `${path}.${defsKey}.${defName}`);
        }
      }
    }
  };

  walk(schema, 0, "$");

  return {
    objectNodes,
    properties,
    optionalParameters,
    unionParameters,
    anyOfNodes,
    allOfNodes,
    oneOfNodes,
    typeArrayNodes,
    maxNestingDepth,
    serializedSchemaBytes: Buffer.byteLength(JSON.stringify(schema), "utf8"),
    refCount,
    constCount,
    patternCount,
    unsupportedConstraintHits,
  };
}
