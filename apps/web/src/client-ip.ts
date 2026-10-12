import { BlockList, isIP } from "node:net";
import type { IncomingMessage } from "node:http";

export function parseTrustedProxyCidrs(
  raw: string | undefined,
): readonly string[] {
  const trimmed = raw?.trim() ?? "";
  if (trimmed.length === 0) {
    return [];
  }

  const cidrs: string[] = [];
  for (const segment of trimmed.split(",")) {
    const value = segment.trim();
    if (value.length === 0) {
      continue;
    }
    if (!isValidCidrOrAddress(value)) {
      throw new Error(
        "OSVA_TRUSTED_PROXIES must be a comma-separated list of IPv4/IPv6 addresses or CIDRs.",
      );
    }
    cidrs.push(value);
  }
  return cidrs;
}

export function resolveRequestSourceIp(
  request: IncomingMessage,
  trustedProxies: readonly string[],
): string {
  const peer = normalizeIpAddress(socketAddress(request.socket.remoteAddress));
  if (peer === undefined) {
    return "unknown";
  }

  if (trustedProxies.length === 0 || !isIpInCidrs(peer, trustedProxies)) {
    return peer;
  }

  const forwarded = rightmostForwardedIp(request);
  return forwarded ?? peer;
}

export function normalizeIpAddress(
  value: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return undefined;
  }

  const unbracketed =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1)
      : trimmed;
  if (unbracketed.startsWith("::ffff:") && isIP(unbracketed) === 6) {
    const mapped = unbracketed.slice("::ffff:".length);
    return isIP(mapped) === 4 ? mapped : unbracketed;
  }
  return unbracketed;
}

function socketAddress(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.startsWith("::ffff:")) {
    return value;
  }
  return value;
}

function rightmostForwardedIp(request: IncomingMessage): string | undefined {
  const forwardedFor = headerValue(request.headers["x-forwarded-for"]);
  if (forwardedFor !== undefined) {
    const parts = forwardedFor.split(",").map((part) => part.trim());
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const normalized = normalizeIpAddress(stripForwardedPort(parts[index]!));
      if (normalized !== undefined && isIP(normalized) !== 0) {
        return normalized;
      }
    }
  }

  const forwarded = headerValue(request.headers.forwarded);
  if (forwarded === undefined) {
    return undefined;
  }
  const matches = [...forwarded.matchAll(/for="?\[?([^\]";,\s]+)/gi)];
  const last = matches.at(-1)?.[1];
  const normalized = normalizeIpAddress(stripForwardedPort(last));
  return normalized !== undefined && isIP(normalized) !== 0
    ? normalized
    : undefined;
}

function stripForwardedPort(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.startsWith("[")) {
    const closing = value.indexOf("]");
    return closing > 0 ? value.slice(1, closing) : value;
  }
  if (isIP(value) === 4) {
    return value;
  }
  const colon = value.lastIndexOf(":");
  if (colon > 0 && isIP(value.slice(0, colon)) === 4) {
    return value.slice(0, colon);
  }
  return value;
}

export function isIpInCidrs(ip: string, cidrs: readonly string[]): boolean {
  const family = isIP(ip);
  if (family === 0) {
    return false;
  }
  const list = new BlockList();
  for (const cidr of cidrs) {
    addCidr(list, cidr);
  }
  return (
    list.check(ip, family === 6 ? "ipv6" : "ipv4") ||
    (family === 4 && list.check(`::ffff:${ip}`, "ipv6"))
  );
}

function isValidCidrOrAddress(value: string): boolean {
  try {
    addCidr(new BlockList(), value);
    return true;
  } catch {
    return false;
  }
}

function addCidr(list: BlockList, value: string): void {
  const slash = value.lastIndexOf("/");
  if (slash === -1) {
    const family = isIP(value);
    if (family === 0) {
      throw new Error("invalid");
    }
    list.addAddress(value, family === 6 ? "ipv6" : "ipv4");
    return;
  }

  const address = value.slice(0, slash);
  const prefix = Number.parseInt(value.slice(slash + 1), 10);
  const family = isIP(address);
  if (family === 0 || !Number.isInteger(prefix)) {
    throw new Error("invalid");
  }
  const maxPrefix = family === 6 ? 128 : 32;
  if (prefix < 0 || prefix > maxPrefix) {
    throw new Error("invalid");
  }
  list.addSubnet(address, prefix, family === 6 ? "ipv6" : "ipv4");
}

function headerValue(
  value: string | readonly string[] | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const raw = typeof value === "string" ? value : value[0];
  const trimmed = raw?.trim() ?? "";
  return trimmed.length === 0 ? undefined : trimmed;
}
