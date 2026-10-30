import { spawnSync } from "node:child_process";

import { assertPublishablePackedManifest } from "./npm-packed-manifest.mjs";
import { NPM_PUBLIC_PACK_ORDER } from "./npm-public-packages.mjs";

/**
 * @param {string} packageName
 * @param {string} version
 * @param {string} field
 */
export function npmViewJsonField(packageName, version, field) {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    npmCmd,
    ["view", `${packageName}@${version}`, field, "--json"],
    {
      encoding: "utf8",
      shell: process.platform === "win32",
      timeout: 45_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `npm view ${packageName}@${version} ${field} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  const trimmed = result.stdout.trim();
  if (trimmed === "" || trimmed === "undefined") {
    return {};
  }
  return JSON.parse(trimmed);
}

/**
 * @param {string} version
 * @param {string} [contextSuffix]
 */
export function auditNpmRegistryDependencyManifests(
  version,
  contextSuffix = "",
) {
  /** @type {Record<string, { dependencies: Record<string, string> }>} */
  const manifests = {};
  for (const name of NPM_PUBLIC_PACK_ORDER) {
    const manifest = {
      name,
      version,
      dependencies: npmViewJsonField(name, version, "dependencies"),
      optionalDependencies: npmViewJsonField(
        name,
        version,
        "optionalDependencies",
      ),
      peerDependencies: npmViewJsonField(name, version, "peerDependencies"),
    };
    assertPublishablePackedManifest(manifest, {
      expectedName: name,
      expectedVersion: version,
      contextLabel: `${name}@${version}${contextSuffix}`,
    });
    manifests[name] = { dependencies: manifest.dependencies ?? {} };
  }
  return manifests;
}
