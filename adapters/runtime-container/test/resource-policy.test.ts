import { describe, expect, it } from "vitest";

import {
  CONTAINER_RESOURCE_EXCEEDS_MAX,
  ContainerResourcePolicyError,
  resolveContainerResources,
} from "../src/resource-policy.js";

const policy = {
  defaults: {
    cpuMillis: 500,
    memoryMiB: 256,
    pids: 128,
  },
  maximums: {
    cpuMillis: 2_000,
    memoryMiB: 1_024,
    pids: 512,
  },
};

describe("resolveContainerResources", () => {
  it("uses operator defaults when AgentVersion resources are absent", () => {
    expect(resolveContainerResources(policy)).toEqual(policy.defaults);
    expect(resolveContainerResources(policy, {})).toEqual(policy.defaults);
  });

  it("uses requested values when they are within configured maximums", () => {
    expect(
      resolveContainerResources(policy, {
        cpuMillis: 1_000,
        memoryMiB: 512,
        pids: 256,
      }),
    ).toEqual({
      cpuMillis: 1_000,
      memoryMiB: 512,
      pids: 256,
    });
  });

  it("resolves each resource dimension independently", () => {
    expect(
      resolveContainerResources(policy, {
        cpuMillis: 1_000,
      }),
    ).toEqual({
      cpuMillis: 1_000,
      memoryMiB: policy.defaults.memoryMiB,
      pids: policy.defaults.pids,
    });
  });

  it("rejects requests above configured maximums without clamping", () => {
    expect(() =>
      resolveContainerResources(policy, {
        cpuMillis: 3_000,
      }),
    ).toThrowError(ContainerResourcePolicyError);

    try {
      resolveContainerResources(policy, {
        memoryMiB: 2_048,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ContainerResourcePolicyError);
      expect((error as ContainerResourcePolicyError).code).toBe(
        CONTAINER_RESOURCE_EXCEEDS_MAX,
      );
      expect((error as ContainerResourcePolicyError).field).toBe("memoryMiB");
    }
  });
});
