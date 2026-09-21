export function readMcpRuntimePolicyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): {
  readonly stdioConnectorsEnabled: boolean;
  readonly allowPrivateNetworks: boolean;
} {
  return {
    stdioConnectorsEnabled: readBoolean(
      env.OSVA_MCP_STDIO_CONNECTORS_ENABLED,
      false,
    ),
    allowPrivateNetworks: readBoolean(
      env.OSVA_MCP_CONNECTOR_ALLOW_PRIVATE_NETWORKS,
      false,
    ),
  };
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  const trimmed = value?.trim().toLowerCase() ?? "";
  if (trimmed.length === 0) {
    return fallback;
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  throw new Error(`${value} must be true or false.`);
}
