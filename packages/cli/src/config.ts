export interface CliConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
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
  if ("api-key" in flags) {
    throw new Error(
      "The --api-key flag is not supported. Set OSVA_API_KEY in the environment.",
    );
  }

  const apiKey = env.OSVA_API_KEY?.trim();

  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new Error("Missing required --base-url or OSVA_BASE_URL.");
  }
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("Missing required OSVA_API_KEY.");
  }

  return {
    baseUrl,
    apiKey,
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
