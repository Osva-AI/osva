/** @deprecated Import from ./lib/targets.mjs — kept for RC4-focused imports. */
export { RC4_TARGET as RC4, RC4_TARGET } from "./lib/targets.mjs";

import { RC4_TARGET } from "./lib/targets.mjs";

/** RC.4 published-artifact identity (registry-only acceptance). */
export const RC4_SEMVER = RC4_TARGET.npmPackageVersion;
export const RC4_PEP440 = RC4_TARGET.pythonPep440;
export const RC4_GIT_TAG = RC4_TARGET.gitTag;
export const RC4_RELEASE_COMMIT = RC4_TARGET.releaseCommit;

export const GHCR_IMAGE_TAG = RC4_TARGET.ghcrImageRef;
export const GHCR_INDEX_DIGEST = RC4_TARGET.ghcrIndexDigest;
export const GHCR_LINUX_AMD64_MANIFEST =
  RC4_TARGET.ghcrLinuxAmd64ManifestDigest;

export const PYPI_WHEEL_SHA256 = RC4_TARGET.pypiWheelSha256;
export const PYPI_SDIST_SHA256 = RC4_TARGET.pypiSdistSha256;

export const COMPOSE_PROJECT = RC4_TARGET.composeProject;

export const NPM_PACKAGES = [
  "@osva-ai/contracts",
  "@osva-ai/runtime-protocol",
  "@osva-ai/sdk",
  "@osva-ai/cli",
  "@osva-ai/connector-sdk",
];
