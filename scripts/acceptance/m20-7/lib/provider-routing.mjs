/**
 * Provider destination classification for live acceptance (no credentials).
 */

/** @type {Readonly<Record<string, string>>} */
export const OFFICIAL_PROVIDER_BASE_URLS = Object.freeze({
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
});

/**
 * @param {string | undefined} baseUrl
 * @returns {"OFFICIAL" | "CUSTOM_PUBLIC" | "PRIVATE_OR_LOOPBACK" | "MISSING"}
 */
export function classifyProviderDestination(baseUrl) {
  if (baseUrl === undefined || baseUrl.trim().length === 0) {
    return "MISSING";
  }
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  for (const official of Object.values(OFFICIAL_PROVIDER_BASE_URLS)) {
    if (normalized === official.replace(/\/+$/, "")) {
      return "OFFICIAL";
    }
  }
  let hostname;
  try {
    hostname = new URL(normalized).hostname.toLowerCase();
  } catch {
    return "PRIVATE_OR_LOOPBACK";
  }
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".local") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  ) {
    return "PRIVATE_OR_LOOPBACK";
  }
  return "CUSTOM_PUBLIC";
}

/**
 * @param {string | undefined} baseUrl
 * @param {readonly string[]} forbiddenOrigins normalized origins (no trailing slash)
 */
export function isForbiddenFakeOrigin(baseUrl, forbiddenOrigins) {
  if (baseUrl === undefined) {
    return false;
  }
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  return forbiddenOrigins.some(
    (o) => normalized === o || normalized.startsWith(`${o}/`),
  );
}

/**
 * @param {{ baseUrl?: string, forbiddenOrigins?: string[] }} input
 * @returns {string | undefined} error code
 */
export function liveEndpointRejectedReason(input) {
  const { baseUrl, forbiddenOrigins = [] } = input;
  if (isForbiddenFakeOrigin(baseUrl, forbiddenOrigins)) {
    return "FAKE_PROVIDER_ENDPOINT_IN_LIVE_MODE";
  }
  const dest = classifyProviderDestination(baseUrl);
  if (dest === "PRIVATE_OR_LOOPBACK") {
    return "PRIVATE_ENDPOINT_IN_LIVE_MODE";
  }
  if (dest === "CUSTOM_PUBLIC") {
    return "UNAPPROVED_PUBLIC_ENDPOINT_OVERRIDE";
  }
  return undefined;
}
