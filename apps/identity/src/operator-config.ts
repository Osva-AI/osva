export interface IdentityOperatorConfig {
  readonly databaseUrl: string;
  readonly authSecret: string;
  readonly authBaseUrl: string;
}

export function loadIdentityOperatorConfig(
  env: NodeJS.ProcessEnv = process.env,
): IdentityOperatorConfig {
  const databaseUrl = readRequired(env.OSVA_DATABASE_URL, "OSVA_DATABASE_URL");
  const authSecret = readRequired(env.OSVA_AUTH_SECRET, "OSVA_AUTH_SECRET");
  if (authSecret.length < 32) {
    throw new Error("OSVA_AUTH_SECRET must be at least 32 characters.");
  }

  const authBaseUrl =
    readOptional(env.OSVA_AUTH_BASE_URL) ?? "http://127.0.0.1:3000";

  return {
    databaseUrl,
    authSecret,
    authBaseUrl: authBaseUrl.replace(/\/+$/, ""),
  };
}

function readRequired(value: string | undefined, name: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return trimmed;
}

function readOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? undefined : trimmed;
}
