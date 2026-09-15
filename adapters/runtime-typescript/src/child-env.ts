import { CHILD_ENV_ALLOWLIST } from "./constants.js";

/**
 * Minimal environment for a trusted TypeScript child process.
 *
 * OSVA_DATABASE_URL, OSVA_VALKEY_URL, NODE_OPTIONS, and other secrets are
 * intentionally omitted. PATH and Windows process-startup variables are kept
 * so Node can start; they are not a capability grant.
 */
export function createChildEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const key of CHILD_ENV_ALLOWLIST) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) {
      env[key] = value;
    }
  }

  return env;
}
