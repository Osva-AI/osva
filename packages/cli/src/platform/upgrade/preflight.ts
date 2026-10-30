import { loadComposeDistribution } from "../../setup/distribution.js";
import type { ResolvedInstallation } from "../types.js";
import { collectPlatformStatus } from "../status.js";
import type { ProbeSpawnFn } from "../../setup/probe-spawn.js";
import { backupRequirementsText } from "./backup-policy.js";
import { resolveUpgradeTarget, type ResolvedUpgradeTarget } from "./catalog.js";
import {
  isIncompleteUpgrade,
  isUpgradeInProgress,
  readUpgradeState,
  recoveryGuidance,
} from "./state.js";

export interface UpgradePreflightReport {
  readonly currentPlatformVersion: string;
  readonly currentImageRef: string;
  readonly targetPlatformVersion: string;
  readonly targetImageRef: string;
  readonly migrationRequired: boolean;
  readonly composeTemplateUpdate: boolean;
  readonly backupRequired: boolean;
  readonly serviceInterruption: string;
  readonly blockingIssues: readonly string[];
  readonly warnings: readonly string[];
  readonly target: ResolvedUpgradeTarget | undefined;
}

export async function runUpgradePreflight(input: {
  readonly installation: ResolvedInstallation;
  readonly toPlatformVersion: string;
  readonly processEnv: NodeJS.ProcessEnv;
  readonly spawn?: ProbeSpawnFn;
  readonly fetch?: typeof fetch;
}): Promise<UpgradePreflightReport> {
  const blockingIssues: string[] = [];
  const warnings: string[] = [];

  const existingState = await readUpgradeState(input.installation.installDir);
  if (isUpgradeInProgress(existingState)) {
    blockingIssues.push(
      `Upgrade already in progress (phase ${existingState!.phase}).`,
    );
  } else if (isIncompleteUpgrade(existingState)) {
    warnings.push(recoveryGuidance(existingState!));
  }

  const currentPlatformVersion = input.installation.marker.platformVersion;
  const currentImageRef = input.installation.marker.imageRef;

  let target: ResolvedUpgradeTarget | undefined;
  try {
    target = await resolveUpgradeTarget({
      toPlatformVersion: input.toPlatformVersion,
      fromPlatformVersion: currentPlatformVersion,
      processEnv: input.processEnv,
    });
  } catch (error) {
    blockingIssues.push(
      error instanceof Error ? error.message : "Unsupported upgrade target.",
    );
  }

  if (target !== undefined) {
    const distribution = await loadComposeDistribution();
    if (distribution.manifest.platformVersion !== target.platformVersion) {
      warnings.push(
        "Target version differs from the bundled CLI distribution metadata; verify image compatibility before proceeding.",
      );
    }
  }

  const status = await collectPlatformStatus(input.installation, {
    spawn: input.spawn,
    fetch: input.fetch,
  });
  if (!status.apiReadyOk) {
    warnings.push(
      "Control plane is not fully ready before upgrade; expect additional startup time after migration.",
    );
  }

  if (currentImageRef !== input.installation.envValues.OSVA_IMAGE) {
    blockingIssues.push(
      "Installation marker and .env image references disagree; repair metadata before upgrading.",
    );
  }

  return {
    currentPlatformVersion,
    currentImageRef,
    targetPlatformVersion: target?.platformVersion ?? input.toPlatformVersion,
    targetImageRef: target?.imageRef ?? "unknown",
    migrationRequired: target?.path.migrationRequired ?? true,
    composeTemplateUpdate: target?.path.composeTemplateUpdate ?? false,
    backupRequired: target?.path.migrationRequired ?? true,
    serviceInterruption:
      "Expect control plane and Console downtime while application services stop, migrations run, and services restart. PostgreSQL and Valkey remain running.",
    blockingIssues,
    warnings,
    target,
  };
}

export function formatUpgradeDryRunHuman(
  report: UpgradePreflightReport,
): string {
  const lines = [
    "OSVA platform upgrade dry-run",
    "",
    `Current: ${report.currentPlatformVersion} (${report.currentImageRef})`,
    `Target:  ${report.target?.platformVersion ?? report.targetPlatformVersion} (${report.target?.imageRef ?? report.targetImageRef})`,
    "",
    `Migration required: ${report.migrationRequired ? "yes" : "no"}`,
    `Compose template update: ${report.composeTemplateUpdate ? "yes" : "no"}`,
    `Service interruption: ${report.serviceInterruption}`,
    "",
    "Backup requirements:",
    backupRequirementsText(),
    "",
  ];
  if (report.blockingIssues.length > 0) {
    lines.push("Blocking issues:");
    for (const issue of report.blockingIssues) {
      lines.push(`  - ${issue}`);
    }
    lines.push("");
  }
  if (report.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of report.warnings) {
      lines.push(`  - ${warning}`);
    }
    lines.push("");
  }
  lines.push(
    "Dry-run is read-only and cannot predict all migration failures. Run with --backup-confirmed and --yes to execute.",
  );
  return `${lines.join("\n")}\n`;
}
