import { describe, expect, it } from "vitest";

import {
  classifyCapabilityBindHost,
  isLoopbackCapabilityBindHost,
  resolveRuntimeCapabilityListenHost,
  validateRuntimeCapabilityListenerConfig,
} from "../src/capability-listener-bind.js";

describe("capability listener bind", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["127.0.0.2", "loopback"],
    ["::1", "loopback"],
    ["[::1]", "loopback"],
    ["localhost", "loopback"],
    ["0.0.0.0", "non_loopback"],
    ["::", "non_loopback"],
    ["[::]", "non_loopback"],
    ["192.168.1.10", "non_loopback"],
    ["8.8.8.8", "non_loopback"],
    ["fe80::1", "non_loopback"],
    ["host.docker.internal", "invalid"],
    ["", "invalid"],
  ] as const)("classifies %s as %s", (host, expected) => {
    expect(classifyCapabilityBindHost(host)).toBe(expected);
    expect(isLoopbackCapabilityBindHost(host)).toBe(expected === "loopback");
  });

  it("defaults non-container workers to the configured host", () => {
    expect(
      resolveRuntimeCapabilityListenHost({
        containerEnabled: false,
        configuredHost: "127.0.0.1",
      }),
    ).toBe("127.0.0.1");
  });

  it("binds all interfaces for container workers", () => {
    expect(
      resolveRuntimeCapabilityListenHost({
        containerEnabled: true,
        configuredHost: "127.0.0.1",
      }),
    ).toBe("0.0.0.0");
  });

  it("skips non-container bind validation when container mode is enabled", () => {
    expect(() =>
      validateRuntimeCapabilityListenerConfig({
        runtimeCapabilitySecret: "secret",
        runtimeCapabilityHost: "192.168.1.10",
        containerEnabled: true,
        allowPublicBind: false,
      }),
    ).not.toThrow();
  });

  it.each(["0.0.0.0", "::", "192.168.1.10", "8.8.8.8", "fe80::1"])(
    "rejects non-loopback %s without opt-in",
    (host) => {
      expect(() =>
        validateRuntimeCapabilityListenerConfig({
          runtimeCapabilitySecret: "secret",
          runtimeCapabilityHost: host,
          containerEnabled: false,
          allowPublicBind: false,
        }),
      ).toThrow(/OSVA_RUNTIME_CAPABILITY_ALLOW_PUBLIC_BIND/);
    },
  );

  it.each(["127.0.0.1", "::1", "[::1]", "localhost"])(
    "allows loopback %s without opt-in",
    (host) => {
      expect(() =>
        validateRuntimeCapabilityListenerConfig({
          runtimeCapabilitySecret: "secret",
          runtimeCapabilityHost: host,
          containerEnabled: false,
          allowPublicBind: false,
        }),
      ).not.toThrow();
    },
  );

  it("allows non-loopback addresses with explicit opt-in", () => {
    expect(() =>
      validateRuntimeCapabilityListenerConfig({
        runtimeCapabilitySecret: "secret",
        runtimeCapabilityHost: "192.168.1.10",
        containerEnabled: false,
        allowPublicBind: true,
      }),
    ).not.toThrow();
  });

  it("rejects ambiguous hostnames even with opt-in", () => {
    expect(() =>
      validateRuntimeCapabilityListenerConfig({
        runtimeCapabilitySecret: "secret",
        runtimeCapabilityHost: "worker.local",
        containerEnabled: true,
        allowPublicBind: true,
      }),
    ).not.toThrow();

    expect(() =>
      validateRuntimeCapabilityListenerConfig({
        runtimeCapabilitySecret: "secret",
        runtimeCapabilityHost: "worker.local",
        containerEnabled: false,
        allowPublicBind: true,
      }),
    ).toThrow(/must be a loopback IP literal/);
  });

  it("skips validation when the capability bridge is disabled", () => {
    expect(() =>
      validateRuntimeCapabilityListenerConfig({
        runtimeCapabilityHost: "0.0.0.0",
        containerEnabled: false,
        allowPublicBind: false,
      }),
    ).not.toThrow();
  });
});
