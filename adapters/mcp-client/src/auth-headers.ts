import type {
  ConnectorAuthConfig,
  ConnectorVersionResourceV1,
  SecretResolver,
} from "@osva/contracts";

export async function resolveConnectorAuthHeaders(
  auth: ConnectorAuthConfig | undefined,
  secretResolver: SecretResolver,
): Promise<Record<string, string>> {
  if (auth === undefined) {
    return {};
  }

  if (auth.type === "BEARER") {
    const token = await secretResolver.resolve(auth.tokenSecret);
    return { Authorization: `Bearer ${token}` };
  }

  const value = await secretResolver.resolve(auth.valueSecret);
  return { [auth.headerName]: value };
}

export function connectorVersionRequiresSecrets(
  connectorVersion: ConnectorVersionResourceV1,
): boolean {
  return connectorVersion.auth !== undefined;
}
