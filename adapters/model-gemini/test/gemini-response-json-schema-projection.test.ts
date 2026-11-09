import { BuilderProposalOpenAiJsonSchema } from "@osva/domain/builder";
import { describe, expect, it } from "vitest";

import {
  GEMINI_DOCUMENTED_RESPONSE_JSON_SCHEMA_KEYWORDS,
  collectJsonSchemaMetaKeywordSet,
  projectJsonSchemaForGeminiResponseJsonSchema,
} from "../src/gemini-response-json-schema-projection.js";

const documented = new Set<string>(
  GEMINI_DOCUMENTED_RESPONSE_JSON_SCHEMA_KEYWORDS,
);

describe("gemini responseJsonSchema projection", () => {
  it("canonical Builder schema still uses const and pattern for OpenAI/domain", () => {
    const canonicalJson = JSON.stringify(BuilderProposalOpenAiJsonSchema);
    expect(canonicalJson).toContain('"const"');
    expect(canonicalJson).toContain('"pattern"');
    expect(BuilderProposalOpenAiJsonSchema).toEqual(
      JSON.parse(JSON.stringify(BuilderProposalOpenAiJsonSchema)),
    );
  });

  it("projects string const to single-value enum and removes pattern", () => {
    const projected = projectJsonSchemaForGeminiResponseJsonSchema(
      BuilderProposalOpenAiJsonSchema,
    );
    const projectedKeys = collectJsonSchemaMetaKeywordSet(projected);

    expect(projectedKeys.has("const")).toBe(false);
    expect(projectedKeys.has("pattern")).toBe(false);
    expect(projectedKeys.has("enum")).toBe(true);

    const root = projected as {
      properties: {
        schemaVersion: { enum?: string[] };
        workflow: {
          properties: {
            nodes: {
              items: {
                anyOf: Array<{
                  properties?: { type?: { enum?: string[] } };
                }>;
              };
            };
          };
        };
      };
    };

    expect(root.properties.schemaVersion.enum).toEqual(["1"]);

    const branch = root.properties.workflow.properties.nodes.items.anyOf.find(
      (variant) => variant.properties?.type?.enum?.[0] === "BRANCH",
    );
    expect(branch).toBeDefined();
    const selector = (
      branch as { properties?: { selector?: Record<string, unknown> } }
    ).properties?.selector;
    expect(selector).toEqual({ type: "string" });
    expect(selector).not.toHaveProperty("pattern");
  });

  it("uses only documented responseJsonSchema keywords (plus enum from const projection)", () => {
    const projected = projectJsonSchemaForGeminiResponseJsonSchema(
      BuilderProposalOpenAiJsonSchema,
    );
    const projectedKeys = collectJsonSchemaMetaKeywordSet(projected);
    for (const key of projectedKeys) {
      expect(documented.has(key)).toBe(true);
    }
  });

  it("does not mutate the canonical schema object", () => {
    const before = JSON.stringify(BuilderProposalOpenAiJsonSchema);
    projectJsonSchemaForGeminiResponseJsonSchema(
      BuilderProposalOpenAiJsonSchema,
    );
    expect(JSON.stringify(BuilderProposalOpenAiJsonSchema)).toBe(before);
  });
});
