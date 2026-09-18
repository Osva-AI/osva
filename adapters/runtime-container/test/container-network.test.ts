import { describe, expect, it } from "vitest";

import {
  CONTAINER_NETWORK_MODE_INVALID,
  ContainerNetworkConfigError,
  assertAllowedContainerNetworkMode,
  isAllowedContainerNetworkMode,
} from "../src/container-network.js";

describe("container network config", () => {
  it("allows bridge and custom operator networks", () => {
    expect(isAllowedContainerNetworkMode("bridge")).toBe(true);
    expect(isAllowedContainerNetworkMode("osva-runtime")).toBe(true);
  });

  it.each(["host", "none", ""])(
    "rejects forbidden network mode %j",
    (networkMode) => {
      expect(isAllowedContainerNetworkMode(networkMode)).toBe(false);
      expect(() => assertAllowedContainerNetworkMode(networkMode)).toThrowError(
        ContainerNetworkConfigError,
      );
    },
  );

  it("surfaces a deterministic error code for forbidden modes", () => {
    try {
      assertAllowedContainerNetworkMode("host");
    } catch (error) {
      expect(error).toBeInstanceOf(ContainerNetworkConfigError);
      expect((error as ContainerNetworkConfigError).code).toBe(
        CONTAINER_NETWORK_MODE_INVALID,
      );
    }
  });
});
