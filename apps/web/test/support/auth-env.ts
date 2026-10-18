/** Keep in sync with packages/db/test/integration/web-auth-env.ts */
export const TEST_AUTH_SECRET =
  "test-osva-auth-secret-with-sufficient-entropy-32";

export function withTestAuthEnv(
  env: Record<string, string>,
): Record<string, string> {
  return {
    OSVA_AUTH_SECRET: TEST_AUTH_SECRET,
    ...env,
  };
}
