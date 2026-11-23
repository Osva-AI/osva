import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readReleaseVersion } from "../read-version.mjs";
import { readRepositoryMigrationHead } from "./read-migration-head.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const COMPOSE_TEMPLATE_ROOT = path.join(
  REPO_ROOT,
  "packages",
  "cli",
  "templates",
  "compose-install",
);

const DEFAULT_GHCR_IMAGE_REPO = "ghcr.io/osva-ai/osva";

function readJson(relativePath) {
  return JSON.parse(
    fs.readFileSync(path.join(COMPOSE_TEMPLATE_ROOT, relativePath), "utf8"),
  );
}

function parsePlatformVersion(raw) {
  const trimmed = raw.trim();
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(trimmed);
  if (match === null) {
    throw new Error(`Invalid platform version '${raw}'.`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease:
      match[4] === undefined || match[4].length === 0
        ? []
        : match[4].split("."),
    raw: trimmed,
  };
}

function comparePlatformVersions(left, right) {
  const a = parsePlatformVersion(left);
  const b = parsePlatformVersion(right);
  if (a.major !== b.major) {
    return a.major < b.major ? -1 : 1;
  }
  if (a.minor !== b.minor) {
    return a.minor < b.minor ? -1 : 1;
  }
  if (a.patch !== b.patch) {
    return a.patch < b.patch ? -1 : 1;
  }
  const aPre = a.prerelease.length > 0;
  const bPre = b.prerelease.length > 0;
  if (!aPre && !bPre) {
    return 0;
  }
  if (!aPre && bPre) {
    return 1;
  }
  if (aPre && !bPre) {
    return -1;
  }
  const len = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < len; index += 1) {
    const aPart = a.prerelease[index];
    const bPart = b.prerelease[index];
    if (aPart === undefined) {
      return -1;
    }
    if (bPart === undefined) {
      return 1;
    }
    if (aPart !== bPart) {
      return aPart < bPart ? -1 : 1;
    }
  }
  return 0;
}

function imageTag(imageRef) {
  const trimmed = imageRef.trim();
  const lastSegment = trimmed.split("/").at(-1) ?? trimmed;
  const colon = lastSegment.lastIndexOf(":");
  if (colon < 0) {
    return null;
  }
  const tag = lastSegment.slice(colon + 1);
  return tag.length > 0 ? tag : null;
}

/**
 * @param {{ readonly repoRoot?: string }} [options]
 * @returns {{ readonly ok: boolean; readonly failures: string[]; readonly details: Record<string, string> }}
 */
export function checkComposeDistributionConsistency(options = {}) {
  const failures = [];
  const details = {};

  const platformVersion = readReleaseVersion();
  details.platformVersion = platformVersion;

  const distribution = readJson("distribution.json");
  details.distributionPlatformVersion = distribution.platformVersion ?? "";
  details.distributionImageRef = distribution.imageRef ?? "";
  details.distributionMigrationHead = distribution.migrationHead ?? "";

  if (distribution.distributionSchemaVersion !== 1) {
    failures.push(
      `distribution.json schemaVersion must be 1 (got ${String(distribution.distributionSchemaVersion)}).`,
    );
  }

  if (distribution.platformVersion !== platformVersion) {
    failures.push(
      `distribution.json platformVersion is ${distribution.platformVersion}, expected VERSION ${platformVersion}.`,
    );
  }

  const tag = imageTag(distribution.imageRef ?? "");
  if (tag === null) {
    failures.push(
      "distribution.json imageRef must include an explicit version tag.",
    );
  } else if (tag === "latest") {
    failures.push("distribution.json imageRef must not use the latest tag.");
  } else if (tag !== distribution.platformVersion) {
    failures.push(
      `distribution.json imageRef tag '${tag}' must match platformVersion '${distribution.platformVersion}'.`,
    );
  }

  const expectedImageRef = `${DEFAULT_GHCR_IMAGE_REPO}:${platformVersion}`;
  if (distribution.imageRef !== expectedImageRef) {
    failures.push(
      `distribution.json imageRef is ${distribution.imageRef}, expected ${expectedImageRef}.`,
    );
  }

  const migrationHead =
    typeof distribution.migrationHead === "string"
      ? distribution.migrationHead.trim()
      : "";
  if (migrationHead.length === 0) {
    failures.push(
      "distribution.json must declare migrationHead for the shipped platform release.",
    );
  }

  const repositoryMigrationHead = readRepositoryMigrationHead();
  details.repositoryMigrationHead = repositoryMigrationHead;

  if (
    migrationHead.length > 0 &&
    repositoryMigrationHead !== migrationHead &&
    distribution.platformVersion === platformVersion
  ) {
    failures.push(
      `Repository migration head is '${repositoryMigrationHead}' but distribution.json migrationHead is '${migrationHead}'. Bump VERSION and refresh distribution metadata before publishing this platform release.`,
    );
  }

  const catalog = readJson("upgrade-catalog.json");
  if (catalog.schemaVersion !== 1) {
    failures.push(
      `upgrade-catalog.json schemaVersion must be 1 (got ${String(catalog.schemaVersion)}).`,
    );
  }

  const targets = Array.isArray(catalog.targets) ? catalog.targets : [];
  const paths = Array.isArray(catalog.paths) ? catalog.paths : [];

  const targetByVersion = new Map();
  for (const target of targets) {
    if (
      typeof target.platformVersion !== "string" ||
      typeof target.imageRef !== "string"
    ) {
      failures.push(
        "upgrade-catalog.json targets must include platformVersion and imageRef.",
      );
      continue;
    }
    targetByVersion.set(target.platformVersion, target);
    const targetTag = imageTag(target.imageRef);
    if (targetTag !== target.platformVersion) {
      failures.push(
        `upgrade-catalog target ${target.platformVersion} imageRef tag '${targetTag}' must match platformVersion.`,
      );
    }
  }

  const distributionTarget = targetByVersion.get(distribution.platformVersion);
  if (distributionTarget === undefined) {
    failures.push(
      `upgrade-catalog.json must list target for platform ${distribution.platformVersion}.`,
    );
  } else if (distributionTarget.imageRef !== distribution.imageRef) {
    failures.push(
      `upgrade-catalog target imageRef (${distributionTarget.imageRef}) must match distribution.json (${distribution.imageRef}).`,
    );
  }

  let highestTarget = targets[0]?.platformVersion;
  for (const target of targets) {
    if (highestTarget === undefined) {
      highestTarget = target.platformVersion;
      continue;
    }
    if (comparePlatformVersions(target.platformVersion, highestTarget) > 0) {
      highestTarget = target.platformVersion;
    }
  }

  if (
    highestTarget !== undefined &&
    highestTarget !== distribution.platformVersion
  ) {
    failures.push(
      `upgrade-catalog highest target (${highestTarget}) must match distribution platformVersion (${distribution.platformVersion}).`,
    );
  }

  const pathKeys = new Set();
  for (const pathRule of paths) {
    if (
      typeof pathRule.fromPlatformVersion !== "string" ||
      typeof pathRule.toPlatformVersion !== "string"
    ) {
      failures.push(
        "upgrade-catalog paths must declare fromPlatformVersion and toPlatformVersion.",
      );
      continue;
    }
    const key = `${pathRule.fromPlatformVersion}→${pathRule.toPlatformVersion}`;
    if (pathKeys.has(key)) {
      failures.push(`Duplicate upgrade path ${key} in upgrade-catalog.json.`);
    }
    pathKeys.add(key);

    if (targetByVersion.get(pathRule.toPlatformVersion) === undefined) {
      failures.push(
        `Upgrade path ${key} references unknown toPlatformVersion ${pathRule.toPlatformVersion}.`,
      );
    }

    if (
      comparePlatformVersions(
        pathRule.fromPlatformVersion,
        pathRule.toPlatformVersion,
      ) >= 0
    ) {
      failures.push(
        `Upgrade path ${key} must move forward in platform version order.`,
      );
    }
  }

  const composePath = path.join(COMPOSE_TEMPLATE_ROOT, "compose.yml");
  const composeYaml = fs.readFileSync(composePath, "utf8");
  if (/\n\s*build\s*:/.test(composeYaml)) {
    failures.push(
      "Bundled compose-install/compose.yml must not contain image build contexts.",
    );
  }
  if (!composeYaml.includes("OSVA_IMAGE:?OSVA_IMAGE is required")) {
    failures.push(
      "Bundled compose-install/compose.yml must require an explicit OSVA_IMAGE.",
    );
  }

  void options.repoRoot;

  return { ok: failures.length === 0, failures, details };
}
