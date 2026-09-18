import type { ContainerRuntimeResources } from "@osva/contracts";

export const CONTAINER_RESOURCE_EXCEEDS_MAX = "CONTAINER_RESOURCE_EXCEEDS_MAX";

export interface ContainerResourceLimits {
  readonly cpuMillis: number;
  readonly memoryMiB: number;
  readonly pids: number;
}

export interface ContainerResourcePolicy {
  readonly defaults: ContainerResourceLimits;
  readonly maximums: ContainerResourceLimits;
}

export const DEFAULT_CONTAINER_RESOURCE_POLICY: ContainerResourcePolicy = {
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

export type ResolvedContainerResources = ContainerResourceLimits;

export class ContainerResourcePolicyError extends Error {
  readonly code = CONTAINER_RESOURCE_EXCEEDS_MAX;

  constructor(
    readonly field: keyof ContainerResourceLimits,
    readonly requested: number,
    readonly maximum: number,
  ) {
    super(
      `Container resource ${field}=${String(requested)} exceeds configured maximum ${String(maximum)}.`,
    );
    this.name = "ContainerResourcePolicyError";
  }
}

function resolveResourceField(
  field: keyof ContainerResourceLimits,
  requested: number | undefined,
  defaults: ContainerResourceLimits,
  maximums: ContainerResourceLimits,
): number {
  const value = requested ?? defaults[field];
  if (value > maximums[field]) {
    throw new ContainerResourcePolicyError(field, value, maximums[field]);
  }
  return value;
}

/**
 * Resolves operator-controlled container resources for one execution.
 * Absent AgentVersion requests use operator defaults. Values above
 * configured maximums are rejected deterministically; they are never clamped.
 */
export function resolveContainerResources(
  policy: ContainerResourcePolicy,
  requested?: ContainerRuntimeResources,
): ResolvedContainerResources {
  return {
    cpuMillis: resolveResourceField(
      "cpuMillis",
      requested?.cpuMillis,
      policy.defaults,
      policy.maximums,
    ),
    memoryMiB: resolveResourceField(
      "memoryMiB",
      requested?.memoryMiB,
      policy.defaults,
      policy.maximums,
    ),
    pids: resolveResourceField(
      "pids",
      requested?.pids,
      policy.defaults,
      policy.maximums,
    ),
  };
}
