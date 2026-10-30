import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { runCommand } from "./npm-command.mjs";
import {
  assertPublishableTarball,
  readPackageJsonFromTarball,
} from "./npm-packed-manifest.mjs";
import {
  NPM_PUBLIC_PACK_ORDER,
  publicPackageRoot,
} from "./npm-public-packages.mjs";

/**
 * @param {string} filePath
 */
export function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

/**
 * @param {object} options
 * @param {string} options.repoRoot
 * @param {string} options.version
 * @param {string} options.packDestination
 * @param {boolean} [options.runBuild]
 * @returns {Map<string, { tarballPath: string, sha256: string, manifest: Record<string, unknown>, fileName: string }>}
 */
export function packPublicNpmPackages(options) {
  const { repoRoot, version, packDestination, runBuild = true } = options;
  fs.mkdirSync(packDestination, { recursive: true });

  if (runBuild) {
    const filters = NPM_PUBLIC_PACK_ORDER.flatMap((name) => ["--filter", name]);
    runCommand("pnpm", ["exec", "turbo", "run", "build", ...filters], {
      cwd: repoRoot,
      stdio: "inherit",
    });
  }

  /** @type {Map<string, { tarballPath: string, sha256: string, manifest: Record<string, unknown>, fileName: string }>} */
  const artifacts = new Map();

  for (const name of NPM_PUBLIC_PACK_ORDER) {
    const packageRoot = publicPackageRoot(repoRoot, name);
    const stdout = runCommand(
      "pnpm",
      ["pack", "--pack-destination", packDestination],
      { cwd: packageRoot },
    );
    const tarballLine = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.endsWith(".tgz"));
    if (!tarballLine) {
      throw new Error(`pnpm pack did not report tarball for ${name}`);
    }
    const tarballPath = path.isAbsolute(tarballLine)
      ? tarballLine
      : path.join(packDestination, path.basename(tarballLine));
    if (!fs.existsSync(tarballPath)) {
      throw new Error(`Tarball missing for ${name}: ${tarballPath}`);
    }

    const manifest = assertPublishableTarball(tarballPath, {
      expectedName: name,
      expectedVersion: version,
    });

    const fileName = path.basename(tarballPath);
    const sha256 = sha256File(tarballPath);
    artifacts.set(name, { tarballPath, sha256, manifest, fileName });
  }

  return artifacts;
}

/**
 * @param {Map<string, { tarballPath: string, sha256: string, manifest: Record<string, unknown>, fileName: string }>} artifacts
 * @param {string} version
 */
export function formatArtifactManifestRecord(artifacts, version) {
  return {
    version,
    generatedAt: new Date().toISOString(),
    packages: [...artifacts.entries()].map(([name, entry]) => ({
      name,
      fileName: entry.fileName,
      tarballPath: entry.tarballPath,
      sha256: entry.sha256,
      dependencies: entry.manifest.dependencies ?? {},
    })),
  };
}

/**
 * @param {string} tarballPath
 */
export function readPackedManifestForInspection(tarballPath) {
  return readPackageJsonFromTarball(tarballPath);
}
