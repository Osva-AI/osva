import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  assertPinnedImageRef,
  loadComposeDistribution,
} from "../../setup/distribution.js";
import { resolveComposeInstallTemplateRoot } from "../../setup/compose-template-root.js";
import { comparePlatformVersions } from "./version.js";

export interface UpgradeTarget {
  readonly platformVersion: string;
  readonly imageRef: string;
}

export interface UpgradePath {
  readonly fromPlatformVersion: string;
  readonly toPlatformVersion: string;
  readonly migrationRequired: boolean;
  readonly composeTemplateUpdate: boolean;
}

interface UpgradeCatalogFile {
  readonly schemaVersion: number;
  readonly targets: readonly UpgradeTarget[];
  readonly paths: readonly UpgradePath[];
}

export interface ResolvedUpgradeTarget {
  readonly platformVersion: string;
  readonly imageRef: string;
  readonly composeYaml: string;
  readonly path: UpgradePath;
}

export async function loadUpgradeCatalog(): Promise<{
  readonly targets: readonly UpgradeTarget[];
  readonly paths: readonly UpgradePath[];
}> {
  const templateRoot = resolveComposeInstallTemplateRoot();
  const catalogPath = path.join(templateRoot, "upgrade-catalog.json");
  const raw = await readFile(catalogPath, "utf8");
  const parsed = JSON.parse(raw) as UpgradeCatalogFile;
  if (parsed.schemaVersion !== 1) {
    throw new Error(
      `Unsupported upgrade catalog schema version ${String(parsed.schemaVersion)}.`,
    );
  }
  return { targets: parsed.targets, paths: parsed.paths };
}

export async function resolveUpgradeTarget(input: {
  readonly toPlatformVersion: string;
  readonly fromPlatformVersion: string;
  readonly processEnv: NodeJS.ProcessEnv;
}): Promise<ResolvedUpgradeTarget> {
  const catalog = await loadUpgradeCatalog();
  const distribution = await loadComposeDistribution();
  const targetEntry =
    catalog.targets.find(
      (target) => target.platformVersion === input.toPlatformVersion,
    ) ??
    (distribution.manifest.platformVersion === input.toPlatformVersion
      ? {
          platformVersion: distribution.manifest.platformVersion,
          imageRef: distribution.manifest.imageRef,
        }
      : undefined);
  if (targetEntry === undefined) {
    throw new Error(
      `Unsupported upgrade target '${input.toPlatformVersion}'. This CLI supports explicit upgrades to: ${catalog.targets.map((target) => target.platformVersion).join(", ")}.`,
    );
  }

  const pathRule = catalog.paths.find(
    (candidate) =>
      candidate.fromPlatformVersion === input.fromPlatformVersion &&
      candidate.toPlatformVersion === input.toPlatformVersion,
  );
  if (pathRule === undefined) {
    throw new Error(
      `No supported upgrade path from ${input.fromPlatformVersion} to ${input.toPlatformVersion}. See docs/operations/UPGRADE.md and docs/release/COMPATIBILITY.md.`,
    );
  }

  if (
    comparePlatformVersions(
      input.fromPlatformVersion,
      input.toPlatformVersion,
    ) >= 0
  ) {
    throw new Error(
      `Refusing downgrade or no-op upgrade (${input.fromPlatformVersion} → ${input.toPlatformVersion}).`,
    );
  }

  const imageRef = resolveUpgradeImageRef({
    target: targetEntry,
    processEnv: input.processEnv,
  });
  assertPinnedImageRef(imageRef);

  return {
    platformVersion: targetEntry.platformVersion,
    imageRef,
    composeYaml: distribution.composeYaml,
    path: pathRule,
  };
}

function resolveUpgradeImageRef(input: {
  readonly target: UpgradeTarget;
  readonly processEnv: NodeJS.ProcessEnv;
}): string {
  const override = input.processEnv.OSVA_UPGRADE_LOCAL_IMAGE?.trim();
  if (override !== undefined && override.length > 0) {
    return override;
  }
  return input.target.imageRef;
}
