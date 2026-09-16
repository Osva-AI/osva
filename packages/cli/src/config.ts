import type { WorkspaceId } from "@osva/contracts";

export interface CliConfig {
  readonly baseUrl: string;
  readonly workspaceId: WorkspaceId;
  readonly json: boolean;
}

export interface ParsedCliArgs {
  readonly command: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

export function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  const flags: Record<string, string | boolean> = {};
  const command: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }
    command.push(token);
  }

  return { command, flags };
}

export function loadCliConfig(
  flags: Readonly<Record<string, string | boolean>>,
  env: NodeJS.ProcessEnv = process.env,
): CliConfig {
  const baseUrl = pickString(flags, env, "base-url", "OSVA_BASE_URL");
  const workspaceId = pickString(
    flags,
    env,
    "workspace-id",
    "OSVA_WORKSPACE_ID",
  );

  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new Error("Missing required --base-url or OSVA_BASE_URL.");
  }
  if (workspaceId === undefined || workspaceId.length === 0) {
    throw new Error("Missing required --workspace-id or OSVA_WORKSPACE_ID.");
  }

  return {
    baseUrl,
    workspaceId: workspaceId as WorkspaceId,
    json: flags.json === true,
  };
}

function pickString(
  flags: Readonly<Record<string, string | boolean>>,
  env: NodeJS.ProcessEnv,
  flagName: string,
  envName: string,
): string | undefined {
  const flagValue = flags[flagName];
  if (typeof flagValue === "string" && flagValue.length > 0) {
    return flagValue;
  }
  const envValue = env[envName];
  if (envValue !== undefined && envValue.length > 0) {
    return envValue;
  }
  return undefined;
}
