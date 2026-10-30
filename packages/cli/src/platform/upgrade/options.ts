import { PlatformCommandError } from "../types.js";

export interface PlatformUpgradeOptions {
  readonly toPlatformVersion: string;
  readonly dryRun: boolean;
  readonly backupConfirmed: boolean;
  readonly authorizeExecute: boolean;
}

export function parsePlatformUpgradeOptions(
  flags: Readonly<Record<string, string | boolean>>,
): PlatformUpgradeOptions {
  const toFlag = flags.to;
  if (toFlag === true || toFlag === undefined) {
    throw new PlatformCommandError(
      "usage",
      "Usage: osva platform upgrade --to VERSION [--dry-run] [--backup-confirmed] [--yes]",
    );
  }
  if (typeof toFlag !== "string" || toFlag.trim().length === 0) {
    throw new PlatformCommandError(
      "usage",
      "--to requires an explicit platform version (for example 1.1.0).",
    );
  }
  return {
    toPlatformVersion: toFlag.trim(),
    dryRun: flags["dry-run"] === true,
    backupConfirmed: flags["backup-confirmed"] === true,
    authorizeExecute: flags.yes === true,
  };
}
