import type { JsonSchemaRecord } from "@osva-ai/contracts";
import { RFC6901_JSON_POINTER_PATTERN } from "@osva-ai/contracts";

const nullableString: JsonSchemaRecord = { type: ["string", "null"] };
const nullableInteger: JsonSchemaRecord = { type: ["integer", "null"] };
const nullableBoolean: JsonSchemaRecord = { type: ["boolean", "null"] };

const builderProposalAgentRefSchema: JsonSchemaRecord = {
  type: "string",
  pattern: "^bpr_[A-Za-z0-9_-]{1,128}$",
};

/** Minimal object-shaped JSON Schema record emitted by the builder (stricter shapes validated downstream). */
const builderProposalJsonSchemaRecord: JsonSchemaRecord = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", const: "object" },
  },
  required: ["type"],
};

const builderProposalNewAgentModelSchema: JsonSchemaRecord = {
  type: "object",
  additionalProperties: false,
  properties: {
    bindingName: { type: "string" },
    modelProfileVersionId: { type: "string" },
  },
  required: ["bindingName", "modelProfileVersionId"],
};

const builderProposalNewAgentToolSchema: JsonSchemaRecord = {
  type: "object",
  additionalProperties: false,
  properties: {
    bindingName: { type: "string" },
    toolVersionId: { type: "string" },
  },
  required: ["bindingName", "toolVersionId"],
};

const builderProposalNewAgentExecutionSchema: JsonSchemaRecord = {
  type: "object",
  additionalProperties: false,
  properties: {
    timeoutMs: { type: "integer" },
    maxAttempts: { type: "integer" },
    maxModelInvocations: { type: "integer" },
    maxToolInvocations: { type: "integer" },
    maxOutputTokens: nullableInteger,
    checkpointingEnabled: nullableBoolean,
    automaticRecoveryEnabled: nullableBoolean,
  },
  required: [
    "timeoutMs",
    "maxAttempts",
    "maxModelInvocations",
    "maxToolInvocations",
    "maxOutputTokens",
    "checkpointingEnabled",
    "automaticRecoveryEnabled",
  ],
};

const builderProposalNewAgentSchema: JsonSchemaRecord = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", const: "NEW" },
    ref: builderProposalAgentRefSchema,
    agentKey: { type: "string" },
    agentName: { type: "string" },
    instructions: { type: "string" },
    inputSchema: builderProposalJsonSchemaRecord,
    outputSchema: builderProposalJsonSchemaRecord,
    modelBindingName: { type: "string" },
    model: builderProposalNewAgentModelSchema,
    tools: {
      type: "array",
      items: builderProposalNewAgentToolSchema,
    },
    execution: builderProposalNewAgentExecutionSchema,
  },
  required: [
    "kind",
    "ref",
    "agentKey",
    "agentName",
    "instructions",
    "inputSchema",
    "outputSchema",
    "modelBindingName",
    "model",
    "tools",
    "execution",
  ],
};

const builderProposalExistingAgentSchema: JsonSchemaRecord = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", const: "EXISTING" },
    ref: builderProposalAgentRefSchema,
    agentVersionId: { type: "string" },
  },
  required: ["kind", "ref", "agentVersionId"],
};

const builderProposalAgentSpecSchema: JsonSchemaRecord = {
  anyOf: [builderProposalNewAgentSchema, builderProposalExistingAgentSchema],
};

const branchEqualsValueSchema: JsonSchemaRecord = {
  anyOf: [
    { type: "string" },
    { type: "number" },
    { type: "boolean" },
    { type: "null" },
  ],
};

const builderProposalBranchCaseSchema: JsonSchemaRecord = {
  type: "object",
  additionalProperties: false,
  properties: {
    equals: branchEqualsValueSchema,
    to: { type: "string" },
  },
  required: ["equals", "to"],
};

const builderProposalAgentNodeSchema: JsonSchemaRecord = {
  type: "object",
  additionalProperties: false,
  properties: {
    key: { type: "string" },
    type: { type: "string", const: "AGENT" },
    agentRef: builderProposalAgentRefSchema,
  },
  required: ["key", "type", "agentRef"],
};

const builderProposalBranchNodeSchema: JsonSchemaRecord = {
  type: "object",
  additionalProperties: false,
  properties: {
    key: { type: "string" },
    type: { type: "string", const: "BRANCH" },
    selector: { type: "string", pattern: RFC6901_JSON_POINTER_PATTERN },
    cases: {
      type: "array",
      items: builderProposalBranchCaseSchema,
    },
    defaultTo: { type: "string" },
  },
  required: ["key", "type", "selector", "cases", "defaultTo"],
};

const builderProposalParallelNodeSchema: JsonSchemaRecord = {
  type: "object",
  additionalProperties: false,
  properties: {
    key: { type: "string" },
    type: { type: "string", const: "PARALLEL" },
  },
  required: ["key", "type"],
};

const builderProposalJoinNodeSchema: JsonSchemaRecord = {
  type: "object",
  additionalProperties: false,
  properties: {
    key: { type: "string" },
    type: { type: "string", const: "JOIN" },
  },
  required: ["key", "type"],
};

const builderProposalApprovalNodeSchema: JsonSchemaRecord = {
  type: "object",
  additionalProperties: false,
  properties: {
    key: { type: "string" },
    type: { type: "string", const: "APPROVAL" },
    title: { type: "string" },
    description: nullableString,
  },
  required: ["key", "type", "title", "description"],
};

const builderProposalWaitDurationSchema: JsonSchemaRecord = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", const: "DURATION" },
    durationMs: { type: "integer" },
  },
  required: ["kind", "durationMs"],
};

const builderProposalWaitUntilSchema: JsonSchemaRecord = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", const: "UNTIL" },
    until: { type: "string" },
  },
  required: ["kind", "until"],
};

const builderProposalWaitEventCorrelationSchema: JsonSchemaRecord = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", const: "LITERAL" },
        value: { type: "string" },
      },
      required: ["kind", "value"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", const: "INPUT_POINTER" },
        pointer: {
          type: "string",
          pattern: RFC6901_JSON_POINTER_PATTERN,
        },
      },
      required: ["kind", "pointer"],
    },
  ],
};

const builderProposalWaitEventSchema: JsonSchemaRecord = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", const: "EVENT" },
    source: { type: "string" },
    eventType: { type: "string" },
    correlation: builderProposalWaitEventCorrelationSchema,
    timeoutMs: nullableInteger,
  },
  required: ["kind", "source", "eventType", "correlation", "timeoutMs"],
};

const builderProposalWaitConfigurationSchema: JsonSchemaRecord = {
  anyOf: [
    builderProposalWaitDurationSchema,
    builderProposalWaitUntilSchema,
    builderProposalWaitEventSchema,
  ],
};

const builderProposalWaitNodeSchema: JsonSchemaRecord = {
  type: "object",
  additionalProperties: false,
  properties: {
    key: { type: "string" },
    type: { type: "string", const: "WAIT" },
    wait: builderProposalWaitConfigurationSchema,
  },
  required: ["key", "type", "wait"],
};

const builderProposalWorkflowNodeSchema: JsonSchemaRecord = {
  anyOf: [
    builderProposalAgentNodeSchema,
    builderProposalBranchNodeSchema,
    builderProposalParallelNodeSchema,
    builderProposalJoinNodeSchema,
    builderProposalApprovalNodeSchema,
    builderProposalWaitNodeSchema,
  ],
};

const builderProposalWorkflowEdgeSchema: JsonSchemaRecord = {
  type: "object",
  additionalProperties: false,
  properties: {
    from: { type: "string" },
    to: { type: "string" },
  },
  required: ["from", "to"],
};

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
    workflowRegistry: {
      type: "object",
      additionalProperties: false,
      properties: {
        key: { type: "string" },
        name: { type: "string" },
        description: nullableString,
      },
      required: ["key", "name", "description"],
    },
    agents: {
      type: "array",
      items: builderProposalAgentSpecSchema,
    },
    workflow: {
      type: "object",
      additionalProperties: false,
      properties: {
        nodes: {
          type: "array",
          items: builderProposalWorkflowNodeSchema,
        },
        edges: {
          type: "array",
          items: builderProposalWorkflowEdgeSchema,
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

/** Exported for strict-schema compliance unit tests. */
export const builderProposalOpenAiJsonSchemaFragments = {
  builderProposalAgentSpecSchema,
  builderProposalWorkflowNodeSchema,
  builderProposalNewAgentSchema,
  builderProposalExistingAgentSchema,
  builderProposalAgentNodeSchema,
  builderProposalBranchNodeSchema,
  builderProposalParallelNodeSchema,
  builderProposalJoinNodeSchema,
  builderProposalApprovalNodeSchema,
  builderProposalWaitNodeSchema,
  builderProposalWaitConfigurationSchema,
} as const;
