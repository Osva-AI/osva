import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { isAllowedRemoteRuntimeEndpoint } from "@osva/contracts";

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type HostnameLookup = (
  hostname: string,
) => Promise<readonly ResolvedAddress[]>;

export interface RemoteHttpOutboundNetworkPolicy {
  readonly allowPrivateNetworks: boolean;
  readonly lookup?: HostnameLookup;
}

export type RemoteHttpDestinationDecision =
  "allowed" | "invalid_endpoint" | "forbidden_destination";

export type RemoteHttpConnectionTarget =
  | { readonly kind: "invalid_endpoint" }
  | { readonly kind: "forbidden_destination" }
  | {
      readonly kind: "allowed";
      readonly url: URL;
      readonly hostname: string;
      readonly pinnedAddress: ResolvedAddress;
    };

export const REMOTE_HTTP_FORBIDDEN_DESTINATION_MESSAGE =
  "Remote runtime endpoint is not an allowed destination.";

/**
 * Resolves an endpoint once, validates every returned address against policy,
 * and returns the deterministic pinned connection target used for the request.
 */
export async function resolveRemoteHttpConnectionTarget(
  endpoint: string,
  policy: RemoteHttpOutboundNetworkPolicy,
): Promise<RemoteHttpConnectionTarget> {
  if (!isAllowedRemoteRuntimeEndpoint(endpoint)) {
    return { kind: "invalid_endpoint" };
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { kind: "invalid_endpoint" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { kind: "invalid_endpoint" };
  }

  if (url.username !== "" || url.password !== "") {
    return { kind: "invalid_endpoint" };
  }

  if (url.hostname.length === 0) {
    return { kind: "invalid_endpoint" };
  }

  const hostname = stripIpv6Brackets(normalizeHostname(url.hostname));
  if (hostname === "localhost") {
    return policy.allowPrivateNetworks
      ? literalConnectionTarget(url, hostname, "127.0.0.1", 4)
      : { kind: "forbidden_destination" };
  }

  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    if (!policy.allowPrivateNetworks && isNonPublicAddress(hostname)) {
      return { kind: "forbidden_destination" };
    }

    return literalConnectionTarget(url, hostname, hostname, literalFamily);
  }

  const lookup = policy.lookup ?? defaultHostnameLookup;
  let addresses: readonly ResolvedAddress[];
  try {
    addresses = await lookup(hostname);
  } catch {
    return { kind: "forbidden_destination" };
  }

  if (addresses.length === 0) {
    return { kind: "forbidden_destination" };
  }

  if (!policy.allowPrivateNetworks) {
    for (const resolved of addresses) {
      if (isNonPublicAddress(resolved.address)) {
        return { kind: "forbidden_destination" };
      }
    }
  }

  const pinnedAddress = selectPinnedAddress(addresses);
  return {
    kind: "allowed",
    url,
    hostname,
    pinnedAddress,
  };
}

/**
 * Default REMOTE_HTTP policy: connect only to public unicast destinations.
 * Private, loopback, link-local, unspecified, and multicast addresses are
 * rejected unless the operator enables `allowPrivateNetworks`.
 */
export async function evaluateRemoteHttpDestination(
  endpoint: string,
  policy: RemoteHttpOutboundNetworkPolicy,
): Promise<RemoteHttpDestinationDecision> {
  const target = await resolveRemoteHttpConnectionTarget(endpoint, policy);
  if (target.kind === "allowed") {
    return "allowed";
  }

  if (target.kind === "invalid_endpoint") {
    return "invalid_endpoint";
  }

  return "forbidden_destination";
}

function literalConnectionTarget(
  url: URL,
  hostname: string,
  address: string,
  family: 4 | 6,
): RemoteHttpConnectionTarget {
  return {
    kind: "allowed",
    url,
    hostname,
    pinnedAddress: { address, family },
  };
}

function selectPinnedAddress(
  addresses: readonly ResolvedAddress[],
): ResolvedAddress {
  return [...addresses].sort((left, right) =>
    left.address.localeCompare(right.address),
  )[0]!;
}

export async function defaultHostnameLookup(
  hostname: string,
): Promise<readonly ResolvedAddress[]> {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((result) => ({
    address: result.address,
    family: result.family === 6 ? 6 : 4,
  }));
}

export function isNonPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return isNonPublicIpv4(address);
  }

  if (family === 6) {
    return isNonPublicIpv6(address);
  }

  return true;
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/u, "");
}

function stripIpv6Brackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }

  return hostname;
}

function isNonPublicIpv4(address: string): boolean {
  const ip = ipv4ToInt(address);
  if (ip === undefined) {
    return true;
  }

  return (
    inIpv4Prefix(ip, "0.0.0.0", 8) ||
    inIpv4Prefix(ip, "10.0.0.0", 8) ||
    inIpv4Prefix(ip, "100.64.0.0", 10) ||
    inIpv4Prefix(ip, "127.0.0.0", 8) ||
    inIpv4Prefix(ip, "169.254.0.0", 16) ||
    inIpv4Prefix(ip, "172.16.0.0", 12) ||
    inIpv4Prefix(ip, "192.168.0.0", 16) ||
    inIpv4Prefix(ip, "224.0.0.0", 4) ||
    inIpv4Prefix(ip, "240.0.0.0", 4)
  );
}

function isNonPublicIpv6(address: string): boolean {
  const groups = parseIpv6(address);
  if (groups === undefined) {
    return true;
  }

  const embedded = embeddedIpv4(groups);
  if (embedded !== undefined && isNonPublicIpv4(embedded)) {
    return true;
  }

  const ip = ipv6GroupsToBigInt(groups);
  return (
    ipv6PrefixMatch(ip, 0n, 128) ||
    ipv6PrefixMatch(ip, 1n, 128) ||
    ipv6PrefixMatch(ip, 0xfe800000000000000000000000000000n, 10) ||
    ipv6PrefixMatch(ip, 0xff000000000000000000000000000000n, 8) ||
    ipv6PrefixMatch(ip, 0xfc000000000000000000000000000000n, 7) ||
    ipv6PrefixMatch(ip, 0xfec00000000000000000000000000000n, 10)
  );
}

function embeddedIpv4(groups: readonly number[]): string | undefined {
  const group0 = groups[0];
  const group1 = groups[1];
  const group2 = groups[2];
  const group3 = groups[3];
  const group4 = groups[4];
  const group5 = groups[5];
  const group6 = groups[6];
  const group7 = groups[7];
  if (
    group0 === undefined ||
    group1 === undefined ||
    group2 === undefined ||
    group3 === undefined ||
    group4 === undefined ||
    group5 === undefined ||
    group6 === undefined ||
    group7 === undefined
  ) {
    return undefined;
  }

  const last = (group6 << 16) | group7;

  const ipv4Mapped =
    group0 === 0 &&
    group1 === 0 &&
    group2 === 0 &&
    group3 === 0 &&
    group4 === 0 &&
    group5 === 0xffff;
  if (ipv4Mapped) {
    return intToIpv4(last);
  }

  const ipv4Compatible =
    group0 === 0 &&
    group1 === 0 &&
    group2 === 0 &&
    group3 === 0 &&
    group4 === 0 &&
    group5 === 0 &&
    last > 1;
  if (ipv4Compatible) {
    return intToIpv4(last);
  }

  const nat64 =
    group0 === 0x64 &&
    group1 === 0xff9b &&
    group2 === 0 &&
    group3 === 0 &&
    group4 === 0 &&
    group5 === 0;
  if (nat64) {
    return intToIpv4(last);
  }

  if (group0 === 0x2002) {
    return intToIpv4((group1 << 16) | group2);
  }

  return undefined;
}

function parseIpv6(address: string): number[] | undefined {
  const withoutZone = address.split("%", 1)[0] ?? address;
  let normalized = withoutZone;
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    if (lastColon < 0) {
      return undefined;
    }

    const head = normalized.slice(0, lastColon + 1);
    const ipv4 = ipv4ToInt(normalized.slice(lastColon + 1));
    if (ipv4 === undefined) {
      return undefined;
    }

    normalized = `${head}${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) {
    return undefined;
  }

  const parseHalve = (value: string | undefined): number[] | undefined => {
    if (value === undefined || value.length === 0) {
      return [];
    }

    const parts = value.split(":");
    const groups: number[] = [];
    for (const part of parts) {
      if (
        part.length === 0 ||
        part.length > 4 ||
        !/^[0-9a-fA-F]+$/u.test(part)
      ) {
        return undefined;
      }

      const group = Number.parseInt(part, 16);
      if (!Number.isInteger(group) || group < 0 || group > 0xffff) {
        return undefined;
      }

      groups.push(group);
    }

    return groups;
  };

  const head = parseHalve(halves[0]);
  const tail = halves.length === 2 ? parseHalve(halves[1]) : [];
  if (head === undefined || tail === undefined) {
    return undefined;
  }

  if (halves.length === 1) {
    return head.length === 8 ? head : undefined;
  }

  const missing = 8 - head.length - tail.length;
  if (missing < 0) {
    return undefined;
  }

  return [...head, ...Array.from({ length: missing }, () => 0), ...tail];
}

function ipv6GroupsToBigInt(groups: readonly number[]): bigint {
  let value = 0n;
  for (const group of groups) {
    value = (value << 16n) + BigInt(group);
  }

  return value;
}

function ipv6PrefixMatch(ip: bigint, prefix: bigint, bits: number): boolean {
  const shift = 128n - BigInt(bits);
  return ip >> shift === prefix >> shift;
}

function ipv4ToInt(address: string): number | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return undefined;
  }

  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) {
      return undefined;
    }

    const octet = Number.parseInt(part, 10);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return undefined;
    }

    value = (value << 8) | octet;
  }

  return value >>> 0;
}

function intToIpv4(value: number): string {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join(".");
}

function inIpv4Prefix(ip: number, prefix: string, bits: number): boolean {
  const prefixInt = ipv4ToInt(prefix);
  if (prefixInt === undefined) {
    return true;
  }

  const mask = bits === 0 ? 0 : (0xffff_ffff << (32 - bits)) >>> 0;
  return (ip & mask) === (prefixInt & mask);
}
