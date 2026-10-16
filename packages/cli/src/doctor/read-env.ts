import type { DoctorEnv } from "./types.js";

export function readDoctorEnv(
  flags: Readonly<Record<string, string | boolean>>,
  processEnv: NodeJS.ProcessEnv = process.env,
): DoctorEnv {
  if ("api-key" in flags) {
    throw new Error(
      "The --api-key flag is not supported. Set OSVA_API_KEY in the environment.",
    );
  }
  const baseUrl = pickOptionalString(
    flags,
    processEnv,
    "base-url",
    "OSVA_BASE_URL",
  );
  const apiKey = processEnv.OSVA_API_KEY?.trim();
  const workspaceId = processEnv.OSVA_WORKSPACE_ID?.trim();

  return {
    ...(baseUrl !== undefined && baseUrl.length > 0 ? { baseUrl } : {}),
    ...(apiKey !== undefined && apiKey.length > 0 ? { apiKey } : {}),
    ...(workspaceId !== undefined && workspaceId.length > 0
      ? { workspaceId }
      : {}),
  };
}

function pickOptionalString(
  flags: Readonly<Record<string, string | boolean>>,
  env: NodeJS.ProcessEnv,
  flagName: string,
  envName: string,
): string | undefined {
  const flagValue = flags[flagName];
  if (typeof flagValue === "string" && flagValue.length > 0) {
    return flagValue.trim();
  }
  const envValue = env[envName]?.trim();
  if (envValue !== undefined && envValue.length > 0) {
    return envValue;
  }
  return undefined;
}
