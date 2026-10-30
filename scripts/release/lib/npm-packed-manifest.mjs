import { spawnSync } from "node:child_process";
import fs from "node:fs";

/** Fields npm may use when resolving an install graph from a published tarball. */
export const NPM_INSTALL_MANIFEST_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "bundledDependencies",
  "bundleDependencies",
];

const FORBIDDEN_PREFIXES = ["catalog:", "workspace:", "file:", "link:"];

/**
 * @param {unknown} spec
 * @returns {boolean}
 */
export function isForbiddenDependencySpec(spec) {
  if (typeof spec !== "string") {
    return true;
  }
  const trimmed = spec.trim();
  if (!trimmed) {
    return true;
  }
  for (const prefix of FORBIDDEN_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return true;
    }
  }
  if (trimmed.startsWith(".") || trimmed.startsWith("/")) {
    return true;
  }
  return false;
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {string} [contextLabel]
 * @returns {{ field: string, name: string, spec: string }[]}
 */
export function collectForbiddenDependencySpecs(manifest, contextLabel = "") {
  /** @type {{ field: string, name: string, spec: string }[]} */
  const violations = [];
  for (const field of NPM_INSTALL_MANIFEST_FIELDS) {
    const block = manifest[field];
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      continue;
    }
    for (const [name, spec] of Object.entries(
      /** @type {Record<string, unknown>} */ (block),
    )) {
      if (typeof spec !== "string") {
        violations.push({
          field,
          name,
          spec: String(spec),
        });
        continue;
      }
      if (isForbiddenDependencySpec(spec)) {
        violations.push({ field, name, spec });
      }
    }
  }
  return violations;
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {{ expectedName?: string, expectedVersion?: string, contextLabel?: string }} [options]
 */
export function assertPublishablePackedManifest(manifest, options = {}) {
  const contextLabel = options.contextLabel ?? manifest.name ?? "package";
  if (options.expectedName && manifest.name !== options.expectedName) {
    throw new Error(
      `${contextLabel}: expected name ${options.expectedName}, got ${JSON.stringify(manifest.name)}`,
    );
  }
  if (options.expectedVersion && manifest.version !== options.expectedVersion) {
    throw new Error(
      `${contextLabel}: expected version ${options.expectedVersion}, got ${JSON.stringify(manifest.version)}`,
    );
  }
  const access = manifest.publishConfig?.access;
  if (access !== undefined && access !== "public") {
    throw new Error(
      `${contextLabel}: publishConfig.access must be public, got ${JSON.stringify(access)}`,
    );
  }
  const violations = collectForbiddenDependencySpecs(manifest, contextLabel);
  if (violations.length > 0) {
    const detail = violations
      .map((v) => `${v.field}.${v.name}=${JSON.stringify(v.spec)}`)
      .join(", ");
    throw new Error(
      `${contextLabel}: publishable manifest contains unsupported dependency protocols: ${detail}`,
    );
  }
}

/**
 * @param {string} tarballPath
 * @returns {Record<string, unknown>}
 */
export function readPackageJsonFromTarball(tarballPath) {
  const result = spawnSync(
    "tar",
    ["-xOf", tarballPath, "package/package.json"],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(
      `Failed to read package/package.json from ${tarballPath}: ${result.stderr || result.stdout}`,
    );
  }
  return JSON.parse(result.stdout);
}

/**
 * @param {string} tarballPath
 * @param {{ expectedName?: string, expectedVersion?: string }} [options]
 */
export function assertPublishableTarball(tarballPath, options = {}) {
  if (!fs.existsSync(tarballPath)) {
    throw new Error(`Tarball missing: ${tarballPath}`);
  }
  const manifest = readPackageJsonFromTarball(tarballPath);
  assertPublishablePackedManifest(manifest, {
    ...options,
    contextLabel: options.expectedName ?? String(manifest.name),
  });
  return manifest;
}
