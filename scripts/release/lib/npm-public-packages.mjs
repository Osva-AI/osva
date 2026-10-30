import path from "node:path";

/** Publication order: upstream workspace packages before dependents. */
export const NPM_PUBLIC_PACK_ORDER = [
  "@osva-ai/contracts",
  "@osva-ai/runtime-protocol",
  "@osva-ai/sdk",
  "@osva-ai/connector-sdk",
  "@osva-ai/cli",
];

/**
 * @param {string} packageName
 */
export function publicPackageDirectory(packageName) {
  return packageName.replace(/^@osva-ai\//, "");
}

/**
 * @param {string} repoRoot
 * @param {string} packageName
 */
export function publicPackageRoot(repoRoot, packageName) {
  return path.join(repoRoot, "packages", publicPackageDirectory(packageName));
}
