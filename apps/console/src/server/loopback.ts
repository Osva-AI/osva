import { isIP } from "node:net";

const IPV4_LOOPBACK_PREFIX = "127.";
const IPV4_MAPPED_PREFIX = "::ffff:";

export function isLoopbackBindHost(host: string): boolean {
  const normalized = normalizeBindHost(host);
  if (normalized === undefined) {
    return false;
  }

  if (normalized === "localhost" || normalized === "::1") {
    return true;
  }

  const ipv4 = ipv4FromLiteral(normalized);
  return ipv4 !== undefined && ipv4.startsWith(IPV4_LOOPBACK_PREFIX);
}

export function normalizeBindHost(host: string): string | undefined {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

export function ipv4FromLiteral(address: string): string | undefined {
  if (isIP(address) === 4) {
    return address;
  }

  if (address.startsWith(IPV4_MAPPED_PREFIX) && isIP(address) === 6) {
    const mapped = address.slice(IPV4_MAPPED_PREFIX.length);
    return isIP(mapped) === 4 ? mapped : undefined;
  }

  return undefined;
}
