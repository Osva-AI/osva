import os from "node:os";
import { readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "../../setup/atomic-write.js";

export const UPGRADE_STATE_RELATIVE = path.join(".osva", "upgrade-state.json");
export const UPGRADE_LOCK_RELATIVE = path.join(".osva", "upgrade.lock");

export type UpgradePhase =
  | "locked"
  | "pulling_image"
  | "prepared_configuration"
  | "stopped_applications"
  | "migrating"
  | "migration_failed"
  | "starting_applications"
  | "validating_readiness"
  | "completed"
  | "failed";

export interface UpgradeState {
  readonly schemaVersion: 1;
  readonly phase: UpgradePhase;
  readonly fromPlatformVersion: string;
  readonly toPlatformVersion: string;
  readonly fromImageRef: string;
  readonly targetImageRef: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly lastError?: string;
  readonly migrationRequired: boolean;
}

export interface UpgradeLock {
  readonly schemaVersion: 1;
  readonly pid: number;
  readonly startedAt: string;
  readonly hostname: string;
}

export async function readUpgradeState(
  installDir: string,
): Promise<UpgradeState | undefined> {
  const statePath = path.join(installDir, UPGRADE_STATE_RELATIVE);
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as UpgradeState;
    if (parsed.schemaVersion !== 1) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export async function writeUpgradeState(
  installDir: string,
  state: UpgradeState,
): Promise<void> {
  const statePath = path.join(installDir, UPGRADE_STATE_RELATIVE);
  await writeFileAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`, {
    restrictPermissions: true,
  });
}

export async function clearUpgradeState(installDir: string): Promise<void> {
  const statePath = path.join(installDir, UPGRADE_STATE_RELATIVE);
  try {
    await unlink(statePath);
  } catch {
    // ignore missing
  }
}

export function isUpgradeInProgress(state: UpgradeState | undefined): boolean {
  if (state === undefined) {
    return false;
  }
  return (
    state.phase !== "completed" &&
    state.phase !== "failed" &&
    state.phase !== "migration_failed"
  );
}

export function isIncompleteUpgrade(state: UpgradeState | undefined): boolean {
  if (state === undefined) {
    return false;
  }
  return (
    state.phase === "failed" ||
    state.phase === "migration_failed" ||
    isUpgradeInProgress(state)
  );
}

export function recoveryGuidance(state: UpgradeState): string {
  switch (state.phase) {
    case "migration_failed":
    case "failed":
      return [
        "An upgrade did not finish successfully.",
        "Database schema may be ahead of the running image — do not downgrade the application image without operator review.",
        "Inspect `osva platform status`, PostgreSQL logs, and docs/operations/UPGRADE.md.",
        state.lastError === undefined ? "" : `Last error: ${state.lastError}`,
      ]
        .filter((line) => line.length > 0)
        .join("\n");
    case "stopped_applications":
    case "migrating":
    case "starting_applications":
    case "validating_readiness":
      return "Upgrade was interrupted mid-flight. Re-run `osva platform upgrade` with the same --to version after resolving Docker health, or follow docs/operations/UPGRADE.md for manual recovery.";
    default:
      return "See docs/operations/UPGRADE.md for incomplete upgrade recovery.";
  }
}

export async function acquireUpgradeLock(installDir: string): Promise<void> {
  const lockPath = path.join(installDir, UPGRADE_LOCK_RELATIVE);
  const existing = await readUpgradeLock(installDir);
  if (existing !== undefined && isProcessAlive(existing.pid)) {
    throw new Error(
      `Another upgrade appears in progress (pid ${String(existing.pid)} since ${existing.startedAt}).`,
    );
  }
  const lock: UpgradeLock = {
    schemaVersion: 1,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    hostname: osHostname(),
  };
  await writeFileAtomic(lockPath, `${JSON.stringify(lock, null, 2)}\n`, {
    restrictPermissions: true,
  });
}

export async function releaseUpgradeLock(installDir: string): Promise<void> {
  const lockPath = path.join(installDir, UPGRADE_LOCK_RELATIVE);
  try {
    await unlink(lockPath);
  } catch {
    // ignore
  }
}

async function readUpgradeLock(
  installDir: string,
): Promise<UpgradeLock | undefined> {
  const lockPath = path.join(installDir, UPGRADE_LOCK_RELATIVE);
  try {
    const raw = await readFile(lockPath, "utf8");
    return JSON.parse(raw) as UpgradeLock;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function osHostname(): string {
  return os.hostname();
}

export async function upgradeStateExists(installDir: string): Promise<boolean> {
  try {
    await stat(path.join(installDir, UPGRADE_STATE_RELATIVE));
    return true;
  } catch {
    return false;
  }
}
