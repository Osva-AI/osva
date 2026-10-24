import { isIP } from "node:net";

/**
 * Capability bridge TCP bind helpers (worker-owned deployment surface).
 */

export type CapabilityBindHostKind = "loopback" | "non_loopback" | "invalid";

/**
 * @deprecated Prefer {@link classifyCapabilityBindHost}. Retained for tests
 * that assert wildcard all-interface literals.
 */
export function isPublicCapabilityBindHost(host: string): boolean {
  return classifyCapabilityBindHost(host) === "non_loopback";
}

/**
 * Classify a configured listen host without DNS lookups or network probing.
 * Only IP literals and the exact hostname `localhost` are accepted.
 */
export function classifyCapabilityBindHost(
  host: string,
): CapabilityBindHostKind {
  const trimmed = host.trim();
  if (trimmed.length === 0) {
    return "invalid";
  }

  const normalized = trimmed.toLowerCase();
  if (normalized === "localhost") {
    return "loopback";
  }

  let ipLiteral = trimmed;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    ipLiteral = trimmed.slice(1, -1);
  }

  const ipVersion = isIP(ipLiteral);
  if (ipVersion === 4) {
    return isIPv4Loopback(ipLiteral) ? "loopback" : "non_loopback";
  }

  if (ipVersion === 6) {
    return isIPv6Loopback(ipLiteral) ? "loopback" : "non_loopback";
  }

  return "invalid";
}

export function isLoopbackCapabilityBindHost(host: string): boolean {
  return classifyCapabilityBindHost(host) === "loopback";
}

/**
 * Container agents reach the worker through Docker bridge/gateway networking.
 * Non-container deployments default to loopback.
 */
export function resolveRuntimeCapabilityListenHost(options: {
  readonly containerEnabled: boolean;
  readonly configuredHost: string;
}): string {
  if (options.containerEnabled) {
    return "0.0.0.0";
  }

  return options.configuredHost;
}

export function validateRuntimeCapabilityListenerConfig(options: {
  readonly runtimeCapabilitySecret?: string;
  readonly runtimeCapabilityHost: string;
  readonly containerEnabled: boolean;
  readonly allowPublicBind: boolean;
}): void {
  if (
    options.runtimeCapabilitySecret === undefined ||
    options.runtimeCapabilitySecret.length === 0
  ) {
    return;
  }

  if (options.containerEnabled) {
    return;
  }

  const kind = classifyCapabilityBindHost(options.runtimeCapabilityHost);
  if (kind === "invalid") {
    throw new Error(
      "OSVA_RUNTIME_CAPABILITY_HOST must be a loopback IP literal (127.0.0.1 or ::1), localhost, or a non-loopback IP address when OSVA_RUNTIME_CAPABILITY_ALLOW_PUBLIC_BIND=true is set. Hostnames other than localhost are not supported.",
    );
  }

  if (kind === "non_loopback" && !options.allowPublicBind) {
    throw new Error(
      "OSVA_RUNTIME_CAPABILITY_HOST binds a non-loopback interface without container isolation. Use the default 127.0.0.1, or set OSVA_RUNTIME_CAPABILITY_ALLOW_PUBLIC_BIND=true to acknowledge network exposure. Opt-in does not provide transport encryption, authentication beyond capability tokens, or runtime isolation.",
    );
  }
}

function isIPv4Loopback(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return false;
  }

  if (parts[0] !== "127") {
    return false;
  }

  return parts.every((part) => {
    const octet = Number.parseInt(part, 10);
    return Number.isInteger(octet) && octet >= 0 && octet <= 255;
  });
}

function isIPv6Loopback(address: string): boolean {
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized === "0:0:0:0:0:0:0:1";
}
