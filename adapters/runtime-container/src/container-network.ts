export const CONTAINER_NETWORK_MODE_INVALID = "CONTAINER_NETWORK_MODE_INVALID";

export const CONTAINER_FORBIDDEN_NETWORK_MODES = ["host", "none"] as const;

export type ContainerForbiddenNetworkMode =
  (typeof CONTAINER_FORBIDDEN_NETWORK_MODES)[number];

/**
 * Operator-controlled Docker network attachment for executable containers.
 * Stage 3.1 does not implement fine-grained internet egress filtering.
 */
export interface ContainerNetworkConfig {
  /**
   * Docker network mode for outbound connectivity to the Runtime Capability Bridge.
   * Must not be `host` or `none`.
   */
  readonly networkMode: string;
}

export class ContainerNetworkConfigError extends Error {
  readonly code = CONTAINER_NETWORK_MODE_INVALID;

  constructor(readonly networkMode: string) {
    super(
      `Container network mode ${JSON.stringify(networkMode)} is forbidden. Use a non-host bridge or custom network.`,
    );
    this.name = "ContainerNetworkConfigError";
  }
}

export function isAllowedContainerNetworkMode(
  networkMode: string,
): networkMode is string {
  if (typeof networkMode !== "string" || networkMode.length === 0) {
    return false;
  }

  return !CONTAINER_FORBIDDEN_NETWORK_MODES.includes(
    networkMode as ContainerForbiddenNetworkMode,
  );
}

export function assertAllowedContainerNetworkMode(networkMode: string): void {
  if (!isAllowedContainerNetworkMode(networkMode)) {
    throw new ContainerNetworkConfigError(networkMode);
  }
}
