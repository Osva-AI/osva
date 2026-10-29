/**
 * Published-artifact acceptance targets. RC4 is registry-verified; stable 1.1.0
 * remains blocked until maintainers record post-publication digests and hashes.
 *
 * @typedef {object} RegistryAcceptanceTarget
 * @property {string} id
 * @property {string} productVersion
 * @property {string} npmPackageVersion
 * @property {string} pythonPyprojectVersion
 * @property {string} pythonPep440
 * @property {string} pipInstallSpec
 * @property {string} ghcrImageRef
 * @property {string | null} ghcrIndexDigest
 * @property {string | null} ghcrLinuxAmd64ManifestDigest
 * @property {string | null} pypiWheelSha256
 * @property {string | null} pypiSdistSha256
 * @property {string} pypiWheelFilename
 * @property {string} pypiSdistFilename
 * @property {"rc" | "latest" | "exact"} npmRegistryMode
 * @property {string} npmViewSelector
 * @property {string} gitTag
 * @property {string | null} releaseCommit
 * @property {string} composeProject
 * @property {string} evidenceReleaseKey
 * @property {boolean} registryArtifactsReady
 * @property {string} envGateVar
 */

/** @type {RegistryAcceptanceTarget} */
export const RC4_TARGET = {
  id: "rc4",
  productVersion: "1.1.0-rc.4",
  npmPackageVersion: "1.1.0-rc.4",
  pythonPyprojectVersion: "1.1.0-rc.4",
  pythonPep440: "1.1.0rc4",
  pipInstallSpec: "osva-sdk==1.1.0rc4",
  ghcrImageRef: "ghcr.io/osva-ai/osva:1.1.0-rc.4",
  ghcrIndexDigest:
    "sha256:59148d75ab75cafcd8d287e95806a9b50d1e022048502f5c9379381b75d16d2f",
  ghcrLinuxAmd64ManifestDigest:
    "sha256:d5ff8e6486944b8939569bc674f28f4496fdf16a846e09e8e0890a6dc3bad0f9",
  pypiWheelSha256:
    "e1eb68454bcdd3c376919bdb88359ba03481d7407ba9ffc358cda862a4671161",
  pypiSdistSha256:
    "067379706602848ab46d8b179a6cfbd4393ecaba75651952dab6791fdf2b579a",
  pypiWheelFilename: "osva_sdk-1.1.0rc4-py3-none-any.whl",
  pypiSdistFilename: "osva_sdk-1.1.0rc4.tar.gz",
  npmRegistryMode: "rc",
  npmViewSelector: "rc",
  gitTag: "v1.1.0-rc.4",
  releaseCommit: "cd38eea46b8ee44bb099ccf307818cfcd348f50b",
  composeProject: "osva-r11-registry-rc4",
  evidenceReleaseKey: "1.1.0-rc.4",
  registryArtifactsReady: true,
  envGateVar: "OSVA_RC4_REGISTRY_ACCEPTANCE",
};

/** @type {RegistryAcceptanceTarget} */
export const STABLE_110_TARGET = {
  id: "stable",
  productVersion: "1.1.0",
  npmPackageVersion: "1.1.0",
  pythonPyprojectVersion: "1.1.0",
  pythonPep440: "1.1.0",
  pipInstallSpec: "osva-sdk==1.1.0",
  ghcrImageRef: "ghcr.io/osva-ai/osva:1.1.0",
  ghcrIndexDigest: null,
  ghcrLinuxAmd64ManifestDigest: null,
  pypiWheelSha256: null,
  pypiSdistSha256: null,
  pypiWheelFilename: "osva_sdk-1.1.0-py3-none-any.whl",
  pypiSdistFilename: "osva_sdk-1.1.0.tar.gz",
  npmRegistryMode: "exact",
  npmViewSelector: "1.1.0",
  gitTag: "v1.1.0",
  releaseCommit: null,
  composeProject: "osva-r11-registry-stable",
  evidenceReleaseKey: "1.1.0",
  registryArtifactsReady: false,
  envGateVar: "OSVA_STABLE_REGISTRY_ACCEPTANCE",
};

const TARGETS = {
  rc4: RC4_TARGET,
  stable: STABLE_110_TARGET,
};

/**
 * @param {string | undefined} [raw]
 * @returns {RegistryAcceptanceTarget}
 */
export function resolveAcceptanceTarget(
  raw = process.env.OSVA_REGISTRY_ACCEPTANCE_TARGET,
) {
  const key = (raw ?? "rc4").trim().toLowerCase();
  const target = TARGETS[key];
  if (!target) {
    throw new Error(
      `Unknown OSVA_REGISTRY_ACCEPTANCE_TARGET=${JSON.stringify(raw)} (expected rc4 or stable)`,
    );
  }
  return target;
}

/**
 * @param {RegistryAcceptanceTarget} target
 */
export function assertTargetEnvGate(target) {
  if (process.env[target.envGateVar] !== "1") {
    throw new Error(
      `Refusing to run ${target.id} registry acceptance without ${target.envGateVar}=1`,
    );
  }
}

/**
 * @param {RegistryAcceptanceTarget} target
 * @returns {{ blocked: true, reason: string } | { blocked: false }}
 */
export function stableTargetReadiness(target) {
  if (target.registryArtifactsReady) {
    return { blocked: false };
  }
  const missing = [];
  if (!target.ghcrIndexDigest) {
    missing.push("ghcrIndexDigest");
  }
  if (!target.pypiWheelSha256 || !target.pypiSdistSha256) {
    missing.push("pypiWheelSha256/pypiSdistSha256");
  }
  if (!target.releaseCommit) {
    missing.push("releaseCommit (frozen stable tag SHA)");
  }
  return {
    blocked: true,
    reason: `Stable target not ready: set registryArtifactsReady and record ${missing.join(", ")} after publication`,
  };
}
