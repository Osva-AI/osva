import { spawnSync } from "node:child_process";

import {
  GHCR_IMAGE_TAG,
  GHCR_INDEX_DIGEST,
  NPM_PACKAGES,
  PYPI_SDIST_SHA256,
  PYPI_WHEEL_SHA256,
  RC4_PEP440,
  RC4_SEMVER,
} from "./constants.mjs";

const NPM_TIMEOUT_MS = 45_000;
const HTTP_TIMEOUT_MS = 45_000;

function npmViewRcVersion(packageName) {
  const result = spawnSync(
    "npm",
    ["view", `${packageName}@rc`, "version", "--json"],
    {
      encoding: "utf8",
      timeout: NPM_TIMEOUT_MS,
      shell: process.platform === "win32",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `npm view ${packageName}@rc failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  const parsed = JSON.parse(result.stdout.trim());
  return String(Array.isArray(parsed) ? parsed[0] : parsed);
}

export async function auditNpmRcVersions() {
  /** @type {Record<string, string>} */
  const versions = {};
  for (const name of NPM_PACKAGES) {
    const version = npmViewRcVersion(name);
    if (version !== RC4_SEMVER) {
      throw new Error(`${name}@rc is ${version}, expected ${RC4_SEMVER}`);
    }
    versions[name] = version;
  }
  return versions;
}

export async function auditPyPiHashes() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://pypi.org/pypi/osva-sdk/${RC4_PEP440}/json`,
      { signal: controller.signal },
    );
    if (!response.ok) {
      throw new Error(`PyPI JSON returned ${response.status}`);
    }
    const body = await response.json();
    const expected = {
      "osva_sdk-1.1.0rc4-py3-none-any.whl": PYPI_WHEEL_SHA256,
      "osva_sdk-1.1.0rc4.tar.gz": PYPI_SDIST_SHA256,
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

export function auditGhcrDigestPull() {
  const inspect = spawnSync(
    "docker",
    ["buildx", "imagetools", "inspect", GHCR_IMAGE_TAG],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (inspect.status !== 0) {
    throw new Error(
      `imagetools inspect failed: ${(inspect.stderr || inspect.stdout).trim()}`,
    );
  }
  if (!inspect.stdout.includes(GHCR_INDEX_DIGEST.replace("sha256:", ""))) {
    throw new Error(
      `GHCR index digest ${GHCR_INDEX_DIGEST} not found in imagetools output`,
    );
  }

  const pull = spawnSync(
    "docker",
    ["pull", "--platform", "linux/amd64", GHCR_IMAGE_TAG],
    { encoding: "utf8", timeout: 600_000 },
  );
  if (pull.status !== 0) {
    throw new Error(
      `docker pull failed: ${(pull.stderr || pull.stdout).trim()}`,
    );
  }

  const imageInspect = spawnSync(
    "docker",
    [
      "image",
      "inspect",
      GHCR_IMAGE_TAG,
      "--format",
      "{{.Os}}/{{.Architecture}}",
    ],
    { encoding: "utf8" },
  );
  if (imageInspect.status !== 0) {
    throw new Error("docker image inspect failed");
  }
  const platform = imageInspect.stdout.trim();
  if (platform !== "linux/amd64") {
    throw new Error(`Expected linux/amd64 platform, got ${platform}`);
  }
  return { indexDigest: GHCR_INDEX_DIGEST, platform };
}
