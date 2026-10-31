import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runIsolatedNpmConsumerSmoke } from "../../../release/lib/npm-consumer-smoke.mjs";
import { packPublicNpmPackages } from "../../../release/lib/npm-pack-public.mjs";
import { readNpmDistributionVersion } from "../../../release/read-version.mjs";
import { createPublishedNpmConsumer } from "../../r11-registry-only/lib/published-npm-consumer.mjs";
import {
  M16_111_TARGET,
  STABLE_110_TARGET,
  assertTargetEnvGate,
  resolveAcceptanceTarget,
  stableTargetReadiness,
} from "../../r11-registry-only/lib/targets.mjs";
import {
  auditGhcrDigestPull,
  auditNpmPublishedVersions,
  auditPyPiHashes,
} from "../../r11-registry-only/registry-audit.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/**
 * @typedef {object} M16ArtifactBundle
 * @property {"published" | "local-pack"} source
 * @property {import("../../r11-registry-only/lib/targets.mjs").RegistryAcceptanceTarget} target
 * @property {string} cliBin
 * @property {string} imageRef
 * @property {string} priorImageRef
 * @property {() => Promise<void>} dispose
 */

/**
 * @returns {Promise<M16ArtifactBundle>}
 */
export async function resolveM16Artifacts() {
  const artifactSource = (
    process.env.OSVA_M16_ARTIFACT_SOURCE ?? "published"
  ).trim();

  if (artifactSource === "local-pack") {
    if (process.env.OSVA_ACCEPTANCE_LIVE !== "1") {
      throw new Error(
        "OSVA_M16_ARTIFACT_SOURCE=local-pack requires OSVA_ACCEPTANCE_LIVE=1",
      );
    }
    const npmVersion = readNpmDistributionVersion();
    const packRoot = await mkdtemp(path.join(os.tmpdir(), "osva-m16-pack-"));
    const artifacts = packPublicNpmPackages({
      repoRoot: REPO_ROOT,
      version: npmVersion,
      packDestination: packRoot,
      runBuild: true,
    });
    const { consumerDir } = runIsolatedNpmConsumerSmoke(artifacts, npmVersion);
    const cliBin = path.join(
      consumerDir,
      "node_modules",
      "@osva-ai",
      "cli",
      "dist",
      "bin",
      "osva.js",
    );
    const consumer = {
      cliBin,
      dispose: async () => {
        await rm(packRoot, { recursive: true, force: true });
      },
    };
    const imageRef =
      process.env.OSVA_M16_LOCAL_IMAGE?.trim() || "osva/local-m16-registry:dev";
    if (process.env.OSVA_M16_SKIP_IMAGE_BUILD !== "1") {
      spawnSync("docker", ["build", "-t", imageRef, "-f", "Dockerfile", "."], {
        cwd: REPO_ROOT,
        stdio: "inherit",
      });
    }
    return {
      source: "local-pack",
      target: { ...M16_111_TARGET, registryArtifactsReady: true },
      cliBin: consumer.cliBin,
      imageRef,
      priorImageRef: STABLE_110_TARGET.ghcrImageRef,
      dispose: consumer.dispose,
    };
  }

  if (artifactSource !== "published") {
    throw new Error(
      `Unknown OSVA_M16_ARTIFACT_SOURCE=${JSON.stringify(artifactSource)}`,
    );
  }

  const target = resolveAcceptanceTarget(
    process.env.OSVA_REGISTRY_ACCEPTANCE_TARGET ?? "m16-111",
  );
  if (target.id !== "m16-111") {
    throw new Error(
      `M16 registry acceptance requires OSVA_REGISTRY_ACCEPTANCE_TARGET=m16-111 (got ${target.id})`,
    );
  }
  assertTargetEnvGate(target);
  const readiness = stableTargetReadiness(target);
  if (readiness.blocked) {
    throw new Error(readiness.reason);
  }

  await auditNpmPublishedVersions(target);
  if (target.pypiWheelSha256 && target.pypiSdistSha256) {
    await auditPyPiHashes(target);
  }
  if (target.ghcrIndexDigest) {
    await auditGhcrDigestPull(target);
  }

  const consumer = await createPublishedNpmConsumer(target.npmPackageVersion);
  return {
    source: "published",
    target,
    cliBin: consumer.cliBin,
    imageRef: target.ghcrImageRef,
    priorImageRef: STABLE_110_TARGET.ghcrImageRef,
    dispose: consumer.dispose,
  };
}
