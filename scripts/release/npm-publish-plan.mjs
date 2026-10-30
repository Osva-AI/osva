#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertExplicitDistTag,
  buildTarballPublishCommands,
  readArtifactManifestFile,
} from "./lib/npm-publish-plan.mjs";
import {
  readNpmDistributionVersion,
  readReleaseVersion,
} from "./read-version.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function printUsage() {
  console.log(`Usage: node scripts/release/npm-publish-plan.mjs --tag <dist-tag>

Prints maintainer npm publish commands for validated tarballs only.
Does not publish.

Options:
  --tag <name>                 Required dist-tag (never defaults to latest)
  --manifest <path>            artifact-manifest.json (default: .release/npm-artifacts/<NPM_DISTRIBUTION_VERSION>/artifact-manifest.json)
  --allow-latest-promotion     Allow --tag latest

Prepare tarballs first:
  node scripts/release/npm-pack-artifacts.mjs
`);
}

function parseArgs(argv) {
  /** @type {{ tag?: string, manifest?: string, allowLatest: boolean }} */
  const parsed = { allowLatest: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--allow-latest-promotion") {
      parsed.allowLatest = true;
      continue;
    }
    if (arg === "--tag") {
      parsed.tag = argv[++i];
      continue;
    }
    if (arg === "--manifest") {
      parsed.manifest = argv[++i];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const platformVersion = readReleaseVersion();
  const npmVersion = readNpmDistributionVersion();
  const manifestPath =
    args.manifest?.trim() ||
    path.join(
      REPO_ROOT,
      ".release",
      "npm-artifacts",
      npmVersion,
      "artifact-manifest.json",
    );

  assertExplicitDistTag(args.tag, { allowLatest: args.allowLatest });
  const record = readArtifactManifestFile(manifestPath);
  if (record.version !== npmVersion) {
    throw new Error(
      `Artifact manifest version ${record.version} does not match npm distribution ${npmVersion}`,
    );
  }

  const commands = buildTarballPublishCommands(record, args.tag);
  console.log(
    `# npm publication plan (platform ${platformVersion}, npm distribution ${npmVersion})`,
  );
  console.log(`# manifest: ${manifestPath}`);
  console.log(`# dist-tag: ${args.tag}`);
  console.log(
    "# Publish in dependency order using the exact validated tarballs:",
  );
  console.log("");
  for (const command of commands) {
    console.log(command);
  }
  console.log("");
  console.log(
    "# Do not run: npm publish ./packages/<name> (unresolved workspace/catalog specs).",
  );
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
