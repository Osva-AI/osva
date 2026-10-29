/** RC.4 published-artifact identity (registry-only acceptance). */
export const RC4_SEMVER = "1.1.0-rc.4";
export const RC4_PEP440 = "1.1.0rc4";
export const RC4_GIT_TAG = "v1.1.0-rc.4";
export const RC4_RELEASE_COMMIT = "cd38eea46b8ee44bb099ccf307818cfcd348f50b";

export const GHCR_IMAGE_TAG = `ghcr.io/osva-ai/osva:${RC4_SEMVER}`;
export const GHCR_INDEX_DIGEST =
  "sha256:59148d75ab75cafcd8d287e95806a9b50d1e022048502f5c9379381b75d16d2f";
export const GHCR_LINUX_AMD64_MANIFEST =
  "sha256:d5ff8e6486944b8939569bc674f28f4496fdf16a846e09e8e0890a6dc3bad0f9";

export const PYPI_WHEEL_SHA256 =
  "e1eb68454bcdd3c376919bdb88359ba03481d7407ba9ffc358cda862a4671161";
export const PYPI_SDIST_SHA256 =
  "067379706602848ab46d8b179a6cfbd4393ecaba75651952dab6791fdf2b579a";

export const COMPOSE_PROJECT = "osva-r11-registry";

export const NPM_PACKAGES = [
  "@osva-ai/contracts",
  "@osva-ai/runtime-protocol",
  "@osva-ai/sdk",
  "@osva-ai/cli",
  "@osva-ai/connector-sdk",
];
