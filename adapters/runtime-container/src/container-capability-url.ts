export const DEFAULT_LINUX_BRIDGE_GATEWAY = "172.17.0.1";

export const CONTAINER_CAPABILITY_URL_INVALID =
  "CONTAINER_CAPABILITY_URL_INVALID";

export class ContainerCapabilityUrlError extends Error {
  readonly code = CONTAINER_CAPABILITY_URL_INVALID;

  constructor(message: string) {
    super(message);
    this.name = "ContainerCapabilityUrlError";
  }
}

/**
 * Suggest a container-reachable capability bridge URL for local Docker.
 * Operators on Linux may need to override the bridge gateway explicitly.
 */
export function suggestContainerCapabilityBaseUrl(
  port: number,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32" || platform === "darwin") {
    return `http://host.docker.internal:${String(port)}`;
  }

  return `http://${DEFAULT_LINUX_BRIDGE_GATEWAY}:${String(port)}`;
}

export function isLoopbackCapabilityUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "::1"
    );
  } catch {
    return true;
  }
}

/**
 * Bridge/custom container networks cannot reach a worker capability server
 * advertised on loopback. Require an operator/container-reachable URL.
 */
export function validateContainerCapabilityBaseUrl(
  url: string,
  networkMode: string,
): void {
  if (networkMode === "host" || networkMode === "none") {
    throw new ContainerCapabilityUrlError(
      `Container network mode ${JSON.stringify(networkMode)} cannot reach the capability bridge.`,
    );
  }

  if (isLoopbackCapabilityUrl(url)) {
    throw new ContainerCapabilityUrlError(
      "OSVA_CONTAINER_CAPABILITY_BASE_URL must be reachable from Docker containers. Loopback URLs such as http://127.0.0.1 are not reachable from bridge containers.",
    );
  }
}

export function resolveContainerCapabilityBaseUrl(options: {
  readonly containerCapabilityBaseUrl?: string;
  readonly runtimeCapabilityBaseUrl?: string;
  readonly suggestedBaseUrl?: string;
}): string | undefined {
  const explicit = options.containerCapabilityBaseUrl?.replace(/\/$/, "");
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }

  const runtime = options.runtimeCapabilityBaseUrl?.replace(/\/$/, "");
  if (runtime !== undefined && runtime.length > 0) {
    return runtime;
  }

  return options.suggestedBaseUrl?.replace(/\/$/, "");
}
