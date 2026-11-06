import type { JsonSchemaRecord } from "@osva-ai/contracts";

/**
 * OpenAI Chat Completions `json_schema` envelope for a single BuilderProposalV1 object.
 * Providers that cannot enforce this must not receive {@link BuilderProposalOpenAiJsonSchema};
 * the service falls back to strict downstream validation.
 */
export const BuilderProposalOpenAiJsonSchema: JsonSchemaRecord = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "string", const: "1" },
    /**
     * OpenAI `json_schema` with `strict: true` requires every `properties` key to appear in `required`
     * and forbids optional keys. Optional `description` is enforced only by downstream parse.
     */
    workflowRegistry: {
      type: "object",
      additionalProperties: false,
      properties: {
        key: { type: "string" },
        name: { type: "string" },
      },
      required: ["key", "name"],
    },
    /**
     * Agent and workflow node shapes are validated strictly by `parseBuilderProposalV1`; allow open objects here
     * so OpenAI strict mode is satisfiable without duplicating the full M20.1 proposal grammar.
     */
    agents: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
    workflow: {
      type: "object",
      additionalProperties: false,
      properties: {
        nodes: {
          type: "array",
          items: { type: "object", additionalProperties: true },
        },
        edges: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              from: { type: "string" },
              to: { type: "string" },
            },
            required: ["from", "to"],
          },
        },
      },
      required: ["nodes", "edges"],
    },
    assumptions: { type: "array", items: { type: "string" } },
    unresolvedRequirements: { type: "array", items: { type: "string" } },
  },
  required: [
    "schemaVersion",
    "workflowRegistry",
    "agents",
    "workflow",
    "assumptions",
    "unresolvedRequirements",
  ],
};
