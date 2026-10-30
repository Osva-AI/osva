import type { InstallationMarker } from "../setup/installation-state.js";
import type { UpgradeState } from "./upgrade/state.js";
import type { InstallEnvValues } from "../setup/env-file.js";
import type { ComposeExecContext } from "../setup/compose-exec.js";

export type ServiceRuntimeState =
  "stopped" | "starting" | "running" | "healthy" | "unhealthy" | "unknown";

export interface ComposeServiceSnapshot {
  readonly name: string;
  readonly state: ServiceRuntimeState;
  readonly statusText: string;
  readonly health: string | undefined;
}

export interface ResolvedInstallation {
  readonly installDir: string;
  readonly marker: InstallationMarker;
  readonly envValues: InstallEnvValues;
  readonly envPath: string;
  readonly composePath: string;
  readonly execCtx: ComposeExecContext;
  readonly webUrl: string;
  readonly mcpUrl: string;
  readonly consoleUrl: string;
}

export interface PlatformStatusReport {
  readonly installation: ResolvedInstallation;
  readonly services: readonly ComposeServiceSnapshot[];
  readonly platformReady: boolean;
  readonly consoleReady: boolean;
  readonly apiHealthOk: boolean;
  readonly apiReadyOk: boolean;
  readonly problems: readonly string[];
  readonly upgradeState: UpgradeState | undefined;
}

export class PlatformCommandError extends Error {
  readonly code:
    | "usage"
    | "installation_missing"
    | "installation_invalid"
    | "env_conflict"
    | "docker_unavailable"
    | "compose_failed"
    | "platform_not_ready";

  constructor(code: PlatformCommandError["code"], message: string) {
    super(message);
    this.code = code;
  }
}
