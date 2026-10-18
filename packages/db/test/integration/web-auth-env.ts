/** Test-only Better Auth secret for integration harnesses (≥ 32 characters). */
export const TEST_AUTH_SECRET =
  "test-osva-auth-secret-with-sufficient-entropy-32";

/**
 * Merges explicit test auth configuration into a web/worker process env object.
 * Caller env wins for keys already set (e.g. custom OSVA_AUTH_BASE_URL).
 */
export function withTestAuthEnv(
  env: Record<string, string>,
): Record<string, string> {
  return {
    OSVA_AUTH_SECRET: TEST_AUTH_SECRET,
    ...env,
  };
}
