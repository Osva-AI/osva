import { spawnSync } from "node:child_process";

import { auditNpmRegistryDependencyManifests } from "../../release/lib/npm-registry-manifest-audit.mjs";
import { NPM_PACKAGES } from "./constants.mjs";

const NPM_TIMEOUT_MS = 45_000;
const HTTP_TIMEOUT_MS = 45_000;

/**
 * @param {import("./lib/targets.mjs").RegistryAcceptanceTarget} target
 */
function npmViewVersion(packageName, target) {
  const selector =
    target.npmRegistryMode === "exact"
      ? target.npmPackageVersion
      : target.npmViewSelector;
  const result = spawnSync(
    "npm",
    ["view", `${packageName}@${selector}`, "version", "--json"],
    {
      encoding: "utf8",
      timeout: NPM_TIMEOUT_MS,
      shell: process.platform === "win32",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `npm view ${packageName}@${selector} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  const parsed = JSON.parse(result.stdout.trim());
  return String(Array.isArray(parsed) ? parsed[0] : parsed);
}

/**
 * @param {import("./lib/targets.mjs").RegistryAcceptanceTarget} target
 */
export async function auditNpmPublishedVersions(target) {
  /** @type {Record<string, string>} */
  const versions = {};
  for (const name of NPM_PACKAGES) {
    const version = npmViewVersion(name, target);
    if (version !== target.npmPackageVersion) {
      throw new Error(
        `${name}@${target.npmViewSelector} is ${version}, expected ${target.npmPackageVersion}`,
      );
    }
    versions[name] = version;
  }
  auditNpmRegistryDependencyManifests(
    target.npmPackageVersion,
    " (registry audit)",
  );
  return versions;
}

/**
 * @param {import("./lib/targets.mjs").RegistryAcceptanceTarget} target
 */
export async function auditPyPiHashes(target) {
  if (!target.pypiWheelSha256 || !target.pypiSdistSha256) {
    throw new Error("PyPI SHA-256 expectations not configured for this target");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://pypi.org/pypi/osva-sdk/${target.pythonPep440}/json`,
      { signal: controller.signal },
    );
    if (!response.ok) {
      throw new Error(`PyPI JSON returned ${response.status}`);
    }
    const body = await response.json();
    const expected = {
      [target.pypiWheelFilename]: target.pypiWheelSha256,
      [target.pypiSdistFilename]: target.pypiSdistSha256,
    };
    /** @type {Record<string, string>} */
    const verified = {};
    for (const [filename, sha256] of Object.entries(expected)) {
      const matches = (body.urls ?? []).filter((u) => u.filename === filename);
      if (matches.length !== 1) {
        throw new Error(`PyPI artifact missing or duplicate: ${filename}`);
      }
      const digest = matches[0].digests?.sha256;
      if (digest !== sha256) {
        throw new Error(`PyPI SHA-256 mismatch for ${filename}`);
      }
      verified[filename] = digest;
    }
    return verified;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {import("./lib/targets.mjs").RegistryAcceptanceTarget} target
 */
export function auditGhcrDigestPull(target) {
  if (!target.ghcrIndexDigest) {
    throw new Error("GHCR index digest not configured for this target");
  }
  const imageRef = target.ghcrImageRef;
  const inspect = spawnSync(
    "docker",
    ["buildx", "imagetools", "inspect", imageRef],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (inspect.status !== 0) {
    throw new Error(
      `imagetools inspect failed: ${(inspect.stderr || inspect.stdout).trim()}`,
    );
  }
  if (!inspect.stdout.includes(target.ghcrIndexDigest.replace("sha256:", ""))) {
    throw new Error(
      `GHCR index digest ${target.ghcrIndexDigest} not found in imagetools output`,
    );
  }

  const pull = spawnSync(
    "docker",
    ["pull", "--platform", "linux/amd64", imageRef],
    { encoding: "utf8", timeout: 600_000 },
  );
  if (pull.status !== 0) {
    throw new Error(
      `docker pull failed: ${(pull.stderr || pull.stdout).trim()}`,
    );
  }

  const imageInspect = spawnSync(
    "docker",
    ["image", "inspect", imageRef, "--format", "{{.Os}}/{{.Architecture}}"],
    { encoding: "utf8" },
  );
  if (imageInspect.status !== 0) {
    throw new Error("docker image inspect failed");
  }
  const platform = imageInspect.stdout.trim();
  if (platform !== "linux/amd64") {
    throw new Error(`Expected linux/amd64 platform, got ${platform}`);
  }
  return { indexDigest: target.ghcrIndexDigest, platform };
}

/** @deprecated Use auditNpmPublishedVersions */
export async function auditNpmRcVersions() {
  const { RC4_TARGET } = await import("./lib/targets.mjs");
  return auditNpmPublishedVersions(RC4_TARGET);
}
