import fs from "node:fs/promises";
import path from "node:path";

import { loadWorkspacePackages } from "./changed-files.mjs";
import { REPO_ROOT } from "./environment.mjs";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/**
 * @typedef {object} WorkspaceManifest
 * @property {string} name
 * @property {string} dir
 * @property {Record<string, string>} deps
 */

/**
 * @returns {Promise<WorkspaceManifest[]>}
 */
export async function loadWorkspaceManifests() {
  const packages = await loadWorkspacePackages();
  const manifests = [];
  for (const pkg of packages) {
    const manifestPath = path.join(REPO_ROOT, pkg.dir, "package.json");
    try {
      const raw = await fs.readFile(manifestPath, "utf8");
      const json = JSON.parse(raw);
      /** @type {Record<string, string>} */
      const deps = {};
      for (const field of DEPENDENCY_FIELDS) {
        const block = json[field];
        if (!block || typeof block !== "object") {
          continue;
        }
        for (const [depName, spec] of Object.entries(block)) {
          if (
            typeof spec === "string" &&
            (spec.startsWith("workspace:") || depName.startsWith("@osva"))
          ) {
            deps[depName] = spec;
          }
        }
      }
      manifests.push({ name: json.name, dir: pkg.dir, deps });
    } catch {
      // skip
    }
  }
  return manifests;
}

/**
 * @param {readonly string[]} changedPackageNames
 * @param {readonly WorkspaceManifest[]} manifests
 * @returns {string[]}
 */
export function directConsumerPackages(changedPackageNames, manifests) {
  const changed = new Set(changedPackageNames);
  const consumers = new Set();
  for (const manifest of manifests) {
    if (changed.has(manifest.name)) {
      continue;
    }
    for (const depName of Object.keys(manifest.deps)) {
      if (changed.has(depName)) {
        consumers.add(manifest.name);
        break;
      }
    }
  }
  return [...consumers].sort();
}

/**
 * Packages that depend on any runtime adapter package.
 *
 * @param {readonly WorkspaceManifest[]} manifests
 */
export function workerRuntimeConsumerPackages(manifests) {
  const adapterNames = new Set(
    manifests
      .filter((manifest) => manifest.dir.startsWith("adapters/runtime-"))
      .map((manifest) => manifest.name),
  );
  return directConsumerPackages([...adapterNames], manifests).filter(
    (name) => name === "@osva/worker" || name.startsWith("@osva/"),
  );
}
