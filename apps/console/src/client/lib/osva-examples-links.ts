/** Audited commit of https://github.com/Osva-AI/osva-examples used for catalog provenance. */
export const OSVA_EXAMPLES_AUDITED_SHA =
  "8c21466162bef3817fcec2ca838302ad75f61552";

export const OSVA_EXAMPLES_REPO = "Osva-AI/osva-examples" as const;

const ALLOWED_HOSTS = new Set(["github.com", "raw.githubusercontent.com"]);

const ALLOWED_REPO_PATH_PREFIXES = [
  `/Osva-AI/osva-examples/blob/${OSVA_EXAMPLES_AUDITED_SHA}/`,
  `/Osva-AI/osva-examples/tree/${OSVA_EXAMPLES_AUDITED_SHA}/`,
  `/Osva-AI/osva-examples/blob/main/`,
  `/Osva-AI/osva-examples/tree/main/`,
  `/Osva-AI/osva-examples`,
] as const;

export function buildExampleReadmeUrl(sourcePath: string): string {
  const normalized = sourcePath.replace(/^\/+|\/+$/g, "");
  return `https://github.com/${OSVA_EXAMPLES_REPO}/blob/${OSVA_EXAMPLES_AUDITED_SHA}/${normalized}/README.md`;
}

export function buildExampleTreeUrl(sourcePath: string): string {
  const normalized = sourcePath.replace(/^\/+|\/+$/g, "");
  return `https://github.com/${OSVA_EXAMPLES_REPO}/tree/${OSVA_EXAMPLES_AUDITED_SHA}/${normalized}`;
}

export function isAllowedOsvaExamplesUrl(url: string): boolean {
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
    return ALLOWED_REPO_PATH_PREFIXES.some((prefix) =>
      parsed.pathname.startsWith(prefix),
    );
  }
  if (parsed.hostname === "raw.githubusercontent.com") {
    return parsed.pathname.startsWith(`/Osva-AI/osva-examples/`);
  }
  return false;
}
