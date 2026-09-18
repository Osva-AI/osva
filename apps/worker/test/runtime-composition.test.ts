import { RuntimeExecutionBootstrapStore } from "@osva/adapters-runtime-http";
import { TrustedTypeScriptRuntimeAdapter } from "@osva/adapters-runtime-typescript";
import { describe, expect, it } from "vitest";

import { loadWorkerConfig } from "../src/config.js";
import { composeRuntimeExecutors } from "../src/runtime-composition.js";

const baseEnv = {
  OSVA_DATABASE_URL: "postgres://osva@127.0.0.1:5432/osva",
  OSVA_VALKEY_URL: "redis://127.0.0.1:6379",
};

describe("composeRuntimeExecutors", () => {
  it("registers CONTAINER only when operator configuration enables it", () => {
    const disabledConfig = loadWorkerConfig(baseEnv);
    expect(disabledConfig.containerEnabled).toBe(false);

    const disabled = composeRuntimeExecutors({
      config: disabledConfig,
      trusted: {
        trustedRuntimeRoot: "/trusted",
        trustedAdapter: new TrustedTypeScriptRuntimeAdapter({
          trustedRuntimeRoot: "/trusted",
        }),
      },
      remoteHttp: {
        getCapabilityBaseUrl: () => "http://127.0.0.1:8080",
        capabilitySecret: "secret",
        allowPrivateNetworks: false,
        clock: { now: () => new Date() },
      },
    });
    expect(disabled.CONTAINER).toBeUndefined();
    expect(disabled.TRUSTED_TYPESCRIPT).toBeDefined();
    expect(disabled.REMOTE_HTTP).toBeDefined();

    const enabledConfig = loadWorkerConfig({
      ...baseEnv,
      OSVA_CONTAINER_ENABLED: "true",
    });
    const enabled = composeRuntimeExecutors({
      config: enabledConfig,
      trusted: {
        trustedRuntimeRoot: "/trusted",
        trustedAdapter: new TrustedTypeScriptRuntimeAdapter({
          trustedRuntimeRoot: "/trusted",
        }),
      },
      remoteHttp: {
        getCapabilityBaseUrl: () => "http://127.0.0.1:8080",
        capabilitySecret: "secret",
        allowPrivateNetworks: false,
        clock: { now: () => new Date() },
      },
      container: {
        getCapabilityBaseUrl: () => "http://host.docker.internal:8080",
        capabilitySecret: "secret",
        executionBootstrap: new RuntimeExecutionBootstrapStore(),
        clock: { now: () => new Date() },
      },
    });
    expect(enabled.CONTAINER).toBeDefined();
  });
});

describe("loadWorkerConfig container settings", () => {
  it("keeps container execution disabled by default", () => {
    expect(loadWorkerConfig(baseEnv)).toMatchObject({
      containerEnabled: false,
      containerNetworkMode: "bridge",
      containerCapabilityBaseUrl: undefined,
    });
  });

  it("loads operator container network and capability override settings", () => {
    expect(
      loadWorkerConfig({
        ...baseEnv,
        OSVA_CONTAINER_ENABLED: "true",
        OSVA_CONTAINER_NETWORK_MODE: "osva-runtime",
        OSVA_CONTAINER_CAPABILITY_BASE_URL: "http://host.docker.internal:8080",
        OSVA_CONTAINER_DEFAULT_CPU_MILLIS: "750",
        OSVA_CONTAINER_MAX_CPU_MILLIS: "1500",
      }),
    ).toMatchObject({
      containerEnabled: true,
      containerNetworkMode: "osva-runtime",
      containerCapabilityBaseUrl: "http://host.docker.internal:8080",
      containerResourcePolicy: {
        defaults: { cpuMillis: 750 },
        maximums: { cpuMillis: 1_500 },
      },
    });
  });

  it("rejects loopback container capability URLs at configuration time", () => {
    expect(() =>
      loadWorkerConfig({
        ...baseEnv,
        OSVA_CONTAINER_ENABLED: "true",
        OSVA_RUNTIME_CAPABILITY_SECRET: "secret",
        OSVA_CONTAINER_CAPABILITY_BASE_URL: "http://127.0.0.1:8080",
      }),
    ).toThrow(/reachable from Docker containers/i);
  });

  it("rejects forbidden container network modes at configuration time", () => {
    expect(() =>
      loadWorkerConfig({
        ...baseEnv,
        OSVA_CONTAINER_ENABLED: "true",
        OSVA_CONTAINER_NETWORK_MODE: "host",
      }),
    ).toThrow(/must not be host or none/i);
  });
});
