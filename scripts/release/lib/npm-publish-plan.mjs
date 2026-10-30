import fs from "node:fs";

import { NPM_PUBLIC_PACK_ORDER } from "./npm-public-packages.mjs";

/**
 * @param {string | undefined} distTag
 * @param {{ allowLatest?: boolean }} [options]
 */
export function assertExplicitDistTag(distTag, options = {}) {
  const tag = (distTag ?? "").trim();
  if (!tag) {
    throw new Error(
      "Dist-tag is required (e.g. rc, stable-candidate). Refusing ambiguous publish.",
    );
  }
  if (tag === "latest" && !options.allowLatest) {
    throw new Error(
      'Refusing to publish with dist-tag "latest" without --allow-latest-promotion',
    );
  }
  return tag;
}

/**
 * @param {object} record
 * @param {string} distTag
 */
export function buildTarballPublishCommands(record, distTag) {
  const tag = assertExplicitDistTag(distTag);
  /** @type {string[]} */
  const commands = [];
  for (const name of NPM_PUBLIC_PACK_ORDER) {
    const pkg = record.packages.find((p) => p.name === name);
    if (!pkg) {
      throw new Error(`Artifact manifest missing package ${name}`);
    }
    if (!fs.existsSync(pkg.tarballPath)) {
      throw new Error(`Tarball missing on disk: ${pkg.tarballPath}`);
    }
    commands.push(
      `npm publish ${JSON.stringify(pkg.tarballPath)} --access public --tag ${tag}`,
    );
  }
  return commands;
}

/**
 * @param {string} manifestPath
 */
export function readArtifactManifestFile(manifestPath) {
  const raw = fs.readFileSync(manifestPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed?.packages || !Array.isArray(parsed.packages)) {
    throw new Error(`Invalid artifact manifest: ${manifestPath}`);
  }
  return parsed;
}

/**
 * @param {string} sourcePackageJsonPath
 */
export function assertRefuseDirectoryPublish(sourcePackageJsonPath) {
  const pkg = JSON.parse(fs.readFileSync(sourcePackageJsonPath, "utf8"));
  const deps = JSON.stringify({
    dependencies: pkg.dependencies,
    optionalDependencies: pkg.optionalDependencies,
    peerDependencies: pkg.peerDependencies,
  });
  if (
    deps.includes("catalog:") ||
    deps.includes("workspace:") ||
    deps.includes("file:") ||
    deps.includes("link:")
  ) {
    throw new Error(
      `Refusing directory publish for ${pkg.name}: source package.json still contains monorepo dependency protocols. Use pnpm pack and npm publish <tarball> instead.`,
    );
  }
}
