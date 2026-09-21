import type { McpConnectorExecutionConfig } from "@osva/contracts";
import type { ConnectorVersion } from "./connector-version.js";

export function toMcpConnectorExecutionConfig(
  version: ConnectorVersion,
): McpConnectorExecutionConfig {
  return {
    connectorVersionId: version.id,
    transport: version.transport,
    transportConfig: version.transportConfig,
    auth: version.auth,
  };
}
