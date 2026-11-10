import {
  BuilderProposalAnthropicRecordsJsonSchema,
  BuilderProposalOpenAiJsonSchema,
} from "@osva/domain/builder";
import { describe, expect, it } from "vitest";

import {
  ANTHROPIC_UNSUPPORTED_JSON_SCHEMA_CONSTRAINT_KEYS,
  collectAnthropicWireSchemaMetaKeywords,
  projectJsonSchemaForAnthropicOutput,
} from "../src/anthropic-response-json-schema-projection.js";
import { auditAnthropicWireJsonSchema } from "../src/anthropic-wire-schema-audit.js";
import {
  ANTHROPIC_STRUCTURED_OUTPUT_OPTIONAL_PARAM_LIMIT,
  ANTHROPIC_STRUCTURED_OUTPUT_UNION_PARAM_LIMIT,
  measureAnthropicWireSchemaComplexity,
} from "../src/anthropic-wire-schema-complexity.js";

describe("anthropic output_config schema projection", () => {
  it("preserves const and strips pattern on the wire (domain validates patterns)", () => {
    const projected = projectJsonSchemaForAnthropicOutput(
      BuilderProposalOpenAiJsonSchema,
    );
    const projectedJson = JSON.stringify(projected);
    expect(projectedJson).toContain('"const"');
    expect(projectedJson).not.toContain('"pattern"');
  });

  it("rewrites nullable type unions to anyOf", () => {
    const projected = projectJsonSchemaForAnthropicOutput({
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: ["string", "null"] },
      },
      required: ["name"],
    }) as {
      properties: { name: { anyOf?: Array<{ type: string }> } };
    };
    expect(projected.properties.name.anyOf).toEqual([
      { type: "string" },
      { type: "null" },
    ]);
  });

  it("strips unsupported numerical and length constraints", () => {
    const projected = projectJsonSchemaForAnthropicOutput({
      type: "object",
      additionalProperties: false,
      properties: {
        count: { type: "integer", minimum: 1, maximum: 10 },
        label: { type: "string", minLength: 1, maxLength: 32 },
      },
      required: ["count", "label"],
    }) as {
      properties: {
        count: Record<string, unknown>;
        label: Record<string, unknown>;
      };
    };
    for (const key of ANTHROPIC_UNSUPPORTED_JSON_SCHEMA_CONSTRAINT_KEYS) {
      expect(projected.properties.count[key]).toBeUndefined();
      expect(projected.properties.label[key]).toBeUndefined();
    }
  });

  it("does not mutate the canonical schema object", () => {
    const before = JSON.stringify(BuilderProposalOpenAiJsonSchema);
    projectJsonSchemaForAnthropicOutput(BuilderProposalOpenAiJsonSchema);
    expect(JSON.stringify(BuilderProposalOpenAiJsonSchema)).toBe(before);
  });

  it("projected builder schema passes Anthropic wire audit", () => {
    const projected = projectJsonSchemaForAnthropicOutput(
      BuilderProposalOpenAiJsonSchema,
    );
    const issues = auditAnthropicWireJsonSchema(projected);
    expect(issues).toEqual([]);
  });

  it("builder projection keeps schema meta keywords", () => {
    const projected = projectJsonSchemaForAnthropicOutput(
      BuilderProposalOpenAiJsonSchema,
    );
    const keys = collectAnthropicWireSchemaMetaKeywords(projected);
    expect(keys.has("anyOf")).toBe(true);
    expect(keys.has("properties")).toBe(true);
    expect(keys.has("const")).toBe(true);
  });

  it("reports projected builder schema complexity budgets", () => {
    const projected = projectJsonSchemaForAnthropicOutput(
      BuilderProposalOpenAiJsonSchema,
    );
    const metrics = measureAnthropicWireSchemaComplexity(projected);
    expect(metrics.unsupportedConstraintHits).toBe(0);
    // Forensic baseline for M20.7.4 live probe (Anthropic HTTP 400).
    expect({
      optionalParameters: metrics.optionalParameters,
      unionParameters: metrics.unionParameters,
      anyOfNodes: metrics.anyOfNodes,
      optionalLimit: ANTHROPIC_STRUCTURED_OUTPUT_OPTIONAL_PARAM_LIMIT,
      unionLimit: ANTHROPIC_STRUCTURED_OUTPUT_UNION_PARAM_LIMIT,
      serializedSchemaBytes: metrics.serializedSchemaBytes,
      maxNestingDepth: metrics.maxNestingDepth,
      objectNodes: metrics.objectNodes,
      patternCount: metrics.patternCount,
      constCount: metrics.constCount,
    }).toMatchInlineSnapshot(`
      {
        "anyOfNodes": 11,
        "constCount": 16,
        "maxNestingDepth": 9,
        "objectNodes": 23,
        "optionalLimit": 24,
        "optionalParameters": 0,
        "patternCount": 0,
        "serializedSchemaBytes": 5178,
        "unionLimit": 16,
        "unionParameters": 11,
      }
    `);
  });

  it("records Builder schema has two object nodes and no unions", () => {
    const projected = projectJsonSchemaForAnthropicOutput(
      BuilderProposalAnthropicRecordsJsonSchema,
    );
    const metrics = measureAnthropicWireSchemaComplexity(projected);
    expect(auditAnthropicWireJsonSchema(projected)).toEqual([]);
    expect(metrics.unsupportedConstraintHits).toBe(0);
    expect(JSON.stringify(projected)).not.toMatch(/"anyOf"/);
    expect(metrics.anyOfNodes).toBe(0);
    expect(metrics.unionParameters).toBe(0);
    expect(metrics.optionalParameters).toBe(0);
    expect(metrics.objectNodes).toBeLessThanOrEqual(3);
    expect(metrics.maxNestingDepth).toBeLessThanOrEqual(3);
    expect(metrics.serializedSchemaBytes).toBeLessThan(2000);
    expect({
      optionalParameters: metrics.optionalParameters,
      unionParameters: metrics.unionParameters,
      anyOfNodes: metrics.anyOfNodes,
      serializedSchemaBytes: metrics.serializedSchemaBytes,
      maxNestingDepth: metrics.maxNestingDepth,
      objectNodes: metrics.objectNodes,
      patternCount: metrics.patternCount,
      constCount: metrics.constCount,
    }).toMatchInlineSnapshot(`
      {
        "anyOfNodes": 0,
        "constCount": 0,
        "maxNestingDepth": 3,
        "objectNodes": 2,
        "optionalParameters": 0,
        "patternCount": 0,
        "serializedSchemaBytes": 728,
        "unionParameters": 0,
      }
    `);
  });
});
