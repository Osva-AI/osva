import { afterEach, describe, expect, it } from "vitest";

import { HelloConfigurationError, loadHelloEnv } from "../scripts/lib/env.js";

const BASE_ENV = {
  OSVA_BASE_URL: "http://127.0.0.1:8080",
  OSVA_API_KEY: "osva_ak_test",
  OSVA_WORKSPACE_ID: "ws-test",
} as const;

describe("Hello Agent env", () => {
  afterEach(() => {
    for (const key of [
      "OSVA_BASE_URL",
      "OSVA_API_KEY",
      "OSVA_WORKSPACE_ID",
      "OSVA_TRUSTED_RUNTIME_ROOT",
      "OSVA_HELLO_TRUSTED_RUNTIME_MODE",
    ]) {
      delete process.env[key];
    }
  });

  it("requires API credentials", () => {
    process.env.OSVA_BASE_URL = BASE_ENV.OSVA_BASE_URL;
    expect(() => loadHelloEnv()).toThrow(HelloConfigurationError);
  });

  it("requires trusted runtime root in host mode", () => {
    Object.assign(process.env, BASE_ENV);
    process.env.OSVA_HELLO_TRUSTED_RUNTIME_MODE = "host";
    expect(() => loadHelloEnv()).toThrow(/OSVA_TRUSTED_RUNTIME_ROOT/);
  });

  it("loads compose mode without host trusted root", () => {
    Object.assign(process.env, BASE_ENV);
    process.env.OSVA_HELLO_TRUSTED_RUNTIME_MODE = "compose";
    const env = loadHelloEnv();
    expect(env.deployMode).toBe("compose");
    expect(env.trustedRuntimeRoot).toBeUndefined();
  });
});
