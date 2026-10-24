import type { ToolInvokeRequest } from "@osva-ai/contracts";
import type { Connector, Tool } from "@osva/domain";

import { toolGatewayError } from "../errors.js";

export function assertToolInvokeIdentity(request: ToolInvokeRequest): void {
  if (request.toolVersionId !== request.authorization.toolVersionId) {
    throw toolGatewayError(
      "TOOL_NOT_AUTHORIZED",
      "Tool invocation was not authorized.",
    );
  }
}

export function assertToolVersionInWorkspace(
  tool: Tool | null,
  authorizedWorkspaceId: ToolInvokeRequest["authorization"]["workspaceId"],
): void {
  if (tool === null || tool.workspaceId !== authorizedWorkspaceId) {
    throw toolGatewayError(
      "TOOL_VERSION_NOT_FOUND",
      "ToolVersion was not found.",
    );
  }
}

export function assertConnectorInWorkspace(
  connector: Connector | null,
  authorizedWorkspaceId: ToolInvokeRequest["authorization"]["workspaceId"],
): void {
  if (connector === null || connector.workspaceId !== authorizedWorkspaceId) {
    throw toolGatewayError(
      "TOOL_IMPLEMENTATION_NOT_FOUND",
      "ConnectorVersion was not found.",
    );
  }
}
