import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/**
 * OSVA platform / runtime release version (VERSION file).
 */
export function readReleaseVersion() {
  const raw = fs.readFileSync(path.join(REPO_ROOT, "VERSION"), "utf8");
  const version = raw.trim();
  if (!SEMVER_RE.test(version)) {
    throw new Error(
      `Invalid VERSION file contents: ${JSON.stringify(version)}`,
    );
  }
  return version;
}

/**
 * Public npm `@osva-ai/*` distribution version. When NPM_DISTRIBUTION_VERSION
 * is present it may diverge from platform VERSION (npm-only corrective releases).
 */
export function readNpmDistributionVersion() {
  const overridePath = path.join(REPO_ROOT, "NPM_DISTRIBUTION_VERSION");
  if (!fs.existsSync(overridePath)) {
    return readReleaseVersion();
  }
  const version = fs.readFileSync(overridePath, "utf8").trim();
  if (!SEMVER_RE.test(version)) {
    throw new Error(
      `Invalid NPM_DISTRIBUTION_VERSION contents: ${JSON.stringify(version)}`,
    );
  }
  return version;
}

/**
 * @param {string} platformVersion
 * @param {string} npmVersion
 */
export function assertNpmDistributionAlignedWithPlatform(
  platformVersion,
  npmVersion,
) {
  const platformBase = platformVersion.split("-")[0];
  const npmBase = npmVersion.split("-")[0];
  const platformParts = platformBase.split(".");
  const npmParts = npmBase.split(".");
  if (platformParts.length < 2 || npmParts.length < 2) {
    throw new Error("Invalid semver for platform/npm alignment check");
  }
  if (platformParts[0] !== npmParts[0] || platformParts[1] !== npmParts[1]) {
    throw new Error(
      `NPM_DISTRIBUTION_VERSION ${npmVersion} must share major.minor with platform VERSION ${platformVersion}`,
    );
  }
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
