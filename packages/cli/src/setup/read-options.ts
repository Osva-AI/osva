import { resolveInstallDir } from "./install-path.js";

export interface SetupOptions {
  readonly webPort: number;
  readonly mcpPort: number;
  readonly consolePort: number;
  readonly installDir: string;
  readonly preflightOnly: boolean;
  readonly authorizeExisting: boolean;
  readonly adminEmail: string;
  readonly adminName: string;
  readonly organizationName: string;
  readonly workspaceName: string;
}

export function readSetupOptions(
  flags: Readonly<Record<string, string | boolean>>,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): SetupOptions {
  const webPort = parsePortFlag(
    flags["web-port"],
    env.OSVA_PUBLISH_WEB_PORT,
    8080,
    "web-port",
  );
  const mcpPort = parsePortFlag(
    flags["mcp-port"],
    env.OSVA_PUBLISH_MCP_PORT,
    3100,
    "mcp-port",
  );
  const consolePort = parsePortFlag(
    flags["console-port"],
    env.OSVA_PUBLISH_CONSOLE_PORT,
    4174,
    "console-port",
  );
  const publishPorts = [
    { port: webPort, label: "web" },
    { port: mcpPort, label: "mcp" },
    { port: consolePort, label: "console" },
  ];
  for (let left = 0; left < publishPorts.length; left += 1) {
    for (let right = left + 1; right < publishPorts.length; right += 1) {
      const a = publishPorts[left];
      const b = publishPorts[right];
      if (a !== undefined && b !== undefined && a.port === b.port) {
        throw new Error(
          `Publish ports must be distinct (${a.label} and ${b.label} both use ${String(a.port)}).`,
        );
      }
    }
  }
  const adminEmail = readOptionalStringFlag(
    flags["admin-email"],
    env.OSVA_SETUP_ADMIN_EMAIL,
  );
  const adminName =
    readOptionalStringFlag(flags["admin-name"], env.OSVA_SETUP_ADMIN_NAME) ??
    "Initial Owner";
  const organizationName =
    readOptionalStringFlag(
      flags["organization-name"],
      env.OSVA_SETUP_ORGANIZATION_NAME,
    ) ?? "Default Organization";
  const workspaceName =
    readOptionalStringFlag(
      flags["workspace-name"],
      env.OSVA_BOOTSTRAP_WORKSPACE_NAME,
    ) ?? "Default Workspace";
  return {
    webPort,
    mcpPort,
    consolePort,
    installDir: resolveInstallDir(flags, env, platform),
    preflightOnly: flags["preflight-only"] === true,
    authorizeExisting: flags.yes === true,
    adminEmail: adminEmail ?? "",
    adminName,
    organizationName,
    workspaceName,
  };
}

function readOptionalStringFlag(
  flagValue: string | boolean | undefined,
  envValue: string | undefined,
): string | undefined {
  if (typeof flagValue === "string" && flagValue.trim().length > 0) {
    return flagValue.trim();
  }
  const trimmedEnv = envValue?.trim();
  return trimmedEnv === undefined || trimmedEnv.length === 0
    ? undefined
    : trimmedEnv;
}

function parsePortFlag(
  flagValue: string | boolean | undefined,
  envValue: string | undefined,
  fallback: number,
  flagName: string,
): number {
  if (typeof flagValue === "boolean") {
    throw new Error(`--${flagName} requires a port number.`);
  }
  const raw =
    typeof flagValue === "string" && flagValue.trim().length > 0
      ? flagValue.trim()
      : envValue?.trim();
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  return parsePortNumber(raw, flagName);
}

export function parsePortNumber(raw: string, flagName: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `Invalid --${flagName} or OSVA_PUBLISH_* value '${raw}'; use an integer from 1 to 65535.`,
    );
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `Invalid --${flagName} or OSVA_PUBLISH_* value '${raw}'; use an integer from 1 to 65535.`,
    );
  }
  return port;
}
