import { discoverConnectorToolsResponseSchema } from "@osva-ai/contracts/schemas";

export const INVALID_MCP_DISCOVERY_TOOLS_MESSAGE =
  "Invalid MCP discovery response: tools must be an array.";

export function parseDiscoverConnectorToolsResponse(
  body: unknown,
): ReturnType<typeof discoverConnectorToolsResponseSchema.parse> {
  if (typeof body !== "object" || body === null) {
    throw new Error(INVALID_MCP_DISCOVERY_TOOLS_MESSAGE);
  }
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.tools)) {
    throw new Error(INVALID_MCP_DISCOVERY_TOOLS_MESSAGE);
  }
  const parsed = discoverConnectorToolsResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(INVALID_MCP_DISCOVERY_TOOLS_MESSAGE);
  }
  return parsed.data;
}
