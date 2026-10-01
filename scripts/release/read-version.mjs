import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export function readReleaseVersion() {
  const raw = fs.readFileSync(path.join(REPO_ROOT, "VERSION"), "utf8");
  const version = raw.trim();
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(
      `Invalid VERSION file contents: ${JSON.stringify(version)}`,
    );
  }
  return version;
}

export const PUBLIC_NPM_PACKAGES = [
  "@osva-ai/contracts",
  "@osva-ai/runtime-protocol",
  "@osva-ai/sdk",
  "@osva-ai/cli",
  "@osva-ai/connector-sdk",
];

export function packageJsonPath(packageName) {
  const dir = packageName.replace(/^@osva-ai\//, "");
  return path.join(REPO_ROOT, "packages", dir, "package.json");
}
