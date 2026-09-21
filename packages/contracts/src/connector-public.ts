import type {
  ConnectorAuthConfig,
  ConnectorTransportConfig,
  StdioTransportConfig,
} from "./connector.js";
import type { ConnectorVersionResourceV1 } from "./connector-registry.js";

export interface PublicSecretBindingV1 {
  readonly configured: true;
}

export interface PublicConnectorBearerAuthConfigV1 {
  readonly type: "BEARER";
  readonly configured: true;
}

export interface PublicConnectorHeaderAuthConfigV1 {
  readonly type: "HEADER";
  readonly headerName: string;
  readonly configured: true;
}

export type PublicConnectorAuthConfigV1 =
  PublicConnectorBearerAuthConfigV1 | PublicConnectorHeaderAuthConfigV1;

export type PublicConnectorTransportConfigV1 =
  ConnectorTransportConfig | PublicStdioTransportConfigV1;

export interface PublicStdioTransportConfigV1 {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly secretEnvironment?: Readonly<Record<string, PublicSecretBindingV1>>;
}

export function mapConnectorAuthToPublic(
  auth: ConnectorAuthConfig | undefined,
): PublicConnectorAuthConfigV1 | undefined {
  if (auth === undefined) {
    return undefined;
  }

  if (auth.type === "BEARER") {
    return { type: "BEARER", configured: true };
  }

  return {
    type: "HEADER",
    headerName: auth.headerName,
    configured: true,
  };
}

export function mapConnectorTransportConfigToPublic(
  transportConfig: ConnectorTransportConfig,
): PublicConnectorTransportConfigV1 {
  if (!("secretEnvironment" in transportConfig)) {
    return transportConfig;
  }

  const stdio = transportConfig as StdioTransportConfig;
  if (stdio.secretEnvironment === undefined) {
    return transportConfig;
  }

  const secretEnvironment = Object.fromEntries(
    Object.keys(stdio.secretEnvironment).map((name) => [
      name,
      { configured: true as const },
    ]),
  );

  return {
    command: stdio.command,
    args: [...stdio.args],
    ...(stdio.cwd === undefined ? {} : { cwd: stdio.cwd }),
    ...(stdio.environment === undefined
      ? {}
      : { environment: { ...stdio.environment } }),
    secretEnvironment,
  };
}

export function mapConnectorVersionToPublicResource(input: {
  readonly id: ConnectorVersionResourceV1["id"];
  readonly connectorId: ConnectorVersionResourceV1["connectorId"];
  readonly version: number;
  readonly kind: ConnectorVersionResourceV1["kind"];
  readonly transport: ConnectorVersionResourceV1["transport"];
  readonly transportConfig: ConnectorTransportConfig;
  readonly auth?: ConnectorAuthConfig;
  readonly createdAt: string;
}): ConnectorVersionResourceV1 {
  return {
    id: input.id,
    connectorId: input.connectorId,
    version: input.version,
    kind: input.kind,
    transport: input.transport,
    transportConfig: mapConnectorTransportConfigToPublic(input.transportConfig),
    auth: mapConnectorAuthToPublic(input.auth),
    createdAt: input.createdAt,
  };
}
