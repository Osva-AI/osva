import {
  isIncompleteUpgrade,
  isUpgradeInProgress,
  readUpgradeState,
  recoveryGuidance,
} from "./upgrade/state.js";
import { PlatformCommandError } from "./types.js";

export async function assertPlatformLifecycleAllowed(
  installDir: string,
  action: string,
): Promise<void> {
  const state = await readUpgradeState(installDir);
  if (isUpgradeInProgress(state)) {
    throw new PlatformCommandError(
      "installation_invalid",
      `Cannot ${action} while platform upgrade is in progress (phase ${state!.phase}).`,
    );
  }
  if (isIncompleteUpgrade(state) && state!.phase !== "migration_failed") {
    throw new PlatformCommandError(
      "installation_invalid",
      `Cannot ${action} until the incomplete upgrade is resolved.\n${recoveryGuidance(state!)}`,
    );
  }
}
