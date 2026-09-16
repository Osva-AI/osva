import type { SecretReference } from "./secret-reference.js";

export const CONNECTOR_KINDS = ["MCP"] as const;

export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

export const CONNECTOR_TRANSPORTS = ["STREAMABLE_HTTP", "STDIO"] as const;

export type ConnectorTransport = (typeof CONNECTOR_TRANSPORTS)[number];

export interface StreamableHttpTransportConfig {
  readonly endpointUrl: string;
}

export interface StdioTransportConfig {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string>>;
}

export type ConnectorTransportConfig =
  StreamableHttpTransportConfig | StdioTransportConfig;

export interface ConnectorBearerAuthConfig {
  readonly type: "BEARER";
  readonly tokenSecret: SecretReference;
}

export interface ConnectorHeaderAuthConfig {
  readonly type: "HEADER";
  readonly headerName: string;
  readonly valueSecret: SecretReference;
}

export type ConnectorAuthConfig =
  ConnectorBearerAuthConfig | ConnectorHeaderAuthConfig;

export function isConnectorKind(value: string): value is ConnectorKind {
  return (CONNECTOR_KINDS as readonly string[]).includes(value);
}

export function isConnectorTransport(
  value: string,
): value is ConnectorTransport {
  return (CONNECTOR_TRANSPORTS as readonly string[]).includes(value);
}

export function isStreamableHttpTransportConfig(
  config: ConnectorTransportConfig,
): config is StreamableHttpTransportConfig {
  return "endpointUrl" in config;
}

export function isStdioTransportConfig(
  config: ConnectorTransportConfig,
): config is StdioTransportConfig {
  return "command" in config;
}
