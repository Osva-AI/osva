/** Audited commit of https://github.com/Osva-AI/osva-connectors used for catalog provenance. */
export const OSVA_CONNECTORS_AUDITED_SHA =
  "f6502a2f8f950f0be4c3454126de6609f48156d2";

export const OSVA_CONNECTORS_REPO = "Osva-AI/osva-connectors" as const;

const ALLOWED_HOSTS = new Set(["github.com", "www.npmjs.com", "npmjs.com"]);

const ALLOWED_GITHUB_PREFIXES = [
  `/Osva-AI/osva-connectors/blob/${OSVA_CONNECTORS_AUDITED_SHA}/`,
  `/Osva-AI/osva-connectors/tree/${OSVA_CONNECTORS_AUDITED_SHA}/`,
] as const;

export function buildConnectorInstallGuideUrl(
  installGuidePath: string,
): string {
  const normalized = installGuidePath.replace(/^\/+|\/+$/g, "");
  return `https://github.com/${OSVA_CONNECTORS_REPO}/blob/${OSVA_CONNECTORS_AUDITED_SHA}/${normalized}`;
}

export function buildConnectorPackageReadmeUrl(
  packageReadmePath: string,
): string {
  const normalized = packageReadmePath.replace(/^\/+|\/+$/g, "");
  return `https://github.com/${OSVA_CONNECTORS_REPO}/blob/${OSVA_CONNECTORS_AUDITED_SHA}/${normalized}`;
}

export function buildConnectorNpmPackageUrl(
  npmPackage: string,
  publishedVersion: string,
): string {
  return `https://www.npmjs.com/package/${encodeURIComponent(npmPackage)}/v/${encodeURIComponent(publishedVersion)}`;
}

export function isAllowedOsvaConnectorsUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return false;
  }
  if (parsed.hostname === "github.com") {
    return ALLOWED_GITHUB_PREFIXES.some((prefix) =>
      parsed.pathname.startsWith(prefix),
    );
  }
  if (parsed.hostname === "www.npmjs.com" || parsed.hostname === "npmjs.com") {
    return parsed.pathname.startsWith("/package/");
  }
  return false;
}
