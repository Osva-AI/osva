import type { ConnectorVersionId } from "./ids.js";
import type {
  ConnectorAuthConfig,
  ConnectorTransport,
  ConnectorTransportConfig,
} from "./connector.js";

/** Internal immutable MCP connector configuration (not a public REST contract). */
export interface McpConnectorExecutionConfig {
  readonly connectorVersionId: ConnectorVersionId;
  readonly transport: ConnectorTransport;
  readonly transportConfig: ConnectorTransportConfig;
  readonly auth?: ConnectorAuthConfig;
}
