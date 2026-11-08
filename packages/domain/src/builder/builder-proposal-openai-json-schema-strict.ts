const UNSUPPORTED_KEYWORDS = new Set([
  "oneOf",
  "allOf",
  "patternProperties",
  "unevaluatedProperties",
  "not",
  "if",
  "then",
  "else",
  "dependentRequired",
  "dependentSchemas",
  "contentSchema",
  "contentMediaType",
  "uniqueItems",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
]);

function schemaRecordHasExplicitType(record: Record<string, unknown>): boolean {
  const type = record.type;
  if (type === undefined) {
    return false;
  }
  if (typeof type === "string") {
    return type.length > 0;
  }
  if (Array.isArray(type) && type.length > 0) {
    return type.every((entry) => typeof entry === "string" && entry.length > 0);
  }
  return false;
}

/** Count const nodes that omit an explicit JSON Schema `type` (OpenAI strict rejection). */
export function countUntypedConstNodes(schema: unknown): number {
  if (schema === null || typeof schema !== "object") {
    return 0;
  }

  if (Array.isArray(schema)) {
    return schema.reduce(
      (count, item) => count + countUntypedConstNodes(item),
      0,
    );
  }

  const record = schema as Record<string, unknown>;
  let count =
    record.const !== undefined && !schemaRecordHasExplicitType(record) ? 1 : 0;

  if (record.properties !== null && typeof record.properties === "object") {
    for (const sub of Object.values(
      record.properties as Record<string, unknown>,
    )) {
      count += countUntypedConstNodes(sub);
    }
  }

  if (Array.isArray(record.anyOf)) {
    for (const variant of record.anyOf) {
      count += countUntypedConstNodes(variant);
    }
  }

  if (record.items !== undefined) {
    count += countUntypedConstNodes(record.items);
  }

  if (record.$defs !== null && typeof record.$defs === "object") {
    for (const def of Object.values(record.$defs as Record<string, unknown>)) {
      count += countUntypedConstNodes(def);
    }
  }

  return count;
}

/**
 * Lint {@link BuilderProposalOpenAiJsonSchema} (and fragments) for OpenAI strict json_schema rules.
 */
export function collectOpenAiStrictViolations(
  schema: unknown,
  path = "$",
): string[] {
  if (schema === null || typeof schema !== "object") {
    return [];
  }

  if (Array.isArray(schema)) {
    return schema.flatMap((item, index) =>
      collectOpenAiStrictViolations(item, `${path}[${String(index)}]`),
    );
  }

  const record = schema as Record<string, unknown>;
  const violations: string[] = [];

  for (const key of Object.keys(record)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) {
      violations.push(`${path}: unsupported keyword '${key}'`);
    }
  }

  if (
    record.const !== undefined &&
    !schemaRecordHasExplicitType(record) &&
    record.$ref === undefined
  ) {
    violations.push(`${path}: const subschema must declare explicit 'type'`);
  }

  if (record.type === "object") {
    if (record.additionalProperties !== false) {
      violations.push(
        `${path}: object schemas must set additionalProperties:false`,
      );
    }

    const properties = record.properties;
    if (properties !== null && typeof properties === "object") {
      const propKeys = Object.keys(properties as Record<string, unknown>);
      const required = Array.isArray(record.required) ? record.required : [];
      for (const propKey of propKeys) {
        if (!required.includes(propKey)) {
          violations.push(
            `${path}: property '${propKey}' must appear in required`,
          );
        }
      }
      for (const propKey of propKeys) {
        violations.push(
          ...collectOpenAiStrictViolations(
            (properties as Record<string, unknown>)[propKey],
            `${path}.properties.${propKey}`,
          ),
        );
      }
    }
  }

  if (record.anyOf !== undefined) {
    const variants = record.anyOf;
    if (Array.isArray(variants)) {
      violations.push(
        ...variants.flatMap((variant, index) =>
          collectOpenAiStrictViolations(
            variant,
            `${path}.anyOf[${String(index)}]`,
          ),
        ),
      );
    }
  }

  if (record.items !== undefined) {
    violations.push(
      ...collectOpenAiStrictViolations(record.items, `${path}.items`),
    );
  }

  if (record.$defs !== null && typeof record.$defs === "object") {
    for (const [defKey, defSchema] of Object.entries(
      record.$defs as Record<string, unknown>,
    )) {
      violations.push(
        ...collectOpenAiStrictViolations(defSchema, `${path}.$defs.${defKey}`),
      );
    }
  }

  return violations;
}
