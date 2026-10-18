import { describe, expect, it } from "vitest";

import {
  TEST_AUTH_SECRET,
  withTestAuthEnv,
} from "./integration/web-auth-env.js";

describe("withTestAuthEnv", () => {
  it("supplies a test-only secret of at least 32 characters", () => {
    const env = withTestAuthEnv({
      OSVA_DATABASE_URL: "postgres://osva@127.0.0.1:5432/osva",
    });

    expect(env.OSVA_AUTH_SECRET).toBe(TEST_AUTH_SECRET);
    expect(TEST_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it("allows callers to override auth fields", () => {
    const custom = "custom-integration-auth-secret-32-chars-min";
    const env = withTestAuthEnv({
      OSVA_AUTH_SECRET: custom,
    });

    expect(env.OSVA_AUTH_SECRET).toBe(custom);
  });
});
