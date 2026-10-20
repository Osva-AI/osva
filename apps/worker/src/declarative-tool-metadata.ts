import type {
  InternalToolImplementationId,
  JsonSchemaRecord,
  ToolVersionId,
} from "@osva-ai/contracts";
import { isInternalToolImplementationId } from "@osva-ai/contracts";
import type { DeclarativeToolMetadata } from "@osva/adapters-runtime-declarative";
import type { ToolRepository } from "@osva/domain";

const INTERNAL_TOOL_INPUT_SCHEMAS: Readonly<
  Record<InternalToolImplementationId, JsonSchemaRecord>
> = Object.freeze({
  OSVA_ECHO_V1: Object.freeze({
    type: "object",
    properties: {
      value: {},
    },
    required: ["value"],
    additionalProperties: false,
  }),
  OSVA_CLOCK_NOW_V1: Object.freeze({
    type: "object",
    properties: {},
    additionalProperties: false,
  }),
});

export function createDeclarativeToolMetadataResolver(
  tools: ToolRepository,
): (input: {
  readonly toolVersionId: ToolVersionId;
}) => Promise<DeclarativeToolMetadata | null> {
  return async ({ toolVersionId }) => {
    const version = await tools.findToolVersionById(toolVersionId);
    if (version === null) {
      return null;
    }

    if (version.type === "MCP" && version.mcp !== undefined) {
      return {
        inputSchema: version.mcp.inputSchema,
        description: version.mcp.description,
      };
    }

    if (!isInternalToolImplementationId(version.implementation)) {
      return null;
    }

    return {
      inputSchema: INTERNAL_TOOL_INPUT_SCHEMAS[version.implementation],
    };
  };
}
