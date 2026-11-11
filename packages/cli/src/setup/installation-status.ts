import type { WorkspaceId } from "@osva-ai/contracts";

export interface InstallationStatusSnapshot {
  readonly schemaVersion: 1;
  readonly workspaceCount: number;
  readonly apiKeyCount: number;
  readonly organizationCount: number;
  readonly humanUserCount: number;
  readonly pendingSetupUserCount: number;
  readonly unlinkedWorkspaceIds: readonly WorkspaceId[];
}

export type AdministratorBootstrapPhase =
  | "fresh_installation"
  | "workspace_without_human_administrator"
  | "administrator_pending_password_setup"
  | "administrator_ready"
  | "multiple_unlinked_workspaces"
  | "ambiguous_workspace_state";

/** Durable installation lifecycle states for CLI onboarding and recovery. */
export type InstallationLifecycleState =
  | "platform_not_installed"
  | "infrastructure_installed"
  | "workspace_bootstrap_pending"
  | "human_administrator_bootstrap_pending"
  | "administrator_password_setup_pending"
  | "administrator_active"
  | "installation_ready"
  | "recovery_required";

export function deriveInstallationLifecycleState(input: {
  readonly hasInstallationMarker: boolean;
  readonly infrastructureReady: boolean;
  readonly status: InstallationStatusSnapshot;
}): InstallationLifecycleState {
  if (!input.hasInstallationMarker) {
    return "platform_not_installed";
  }
  if (!input.infrastructureReady) {
    return "infrastructure_installed";
  }
  if (input.status.workspaceCount === 0) {
    return "workspace_bootstrap_pending";
  }

  const adminPhase = classifyAdministratorBootstrapPhase(input.status);
  if (adminPhase === "multiple_unlinked_workspaces") {
    return "recovery_required";
  }
  if (adminPhase === "ambiguous_workspace_state") {
    return "recovery_required";
  }
  if (
    adminPhase === "fresh_installation" ||
    adminPhase === "workspace_without_human_administrator"
  ) {
    return "human_administrator_bootstrap_pending";
  }
  if (adminPhase === "administrator_pending_password_setup") {
    return "administrator_password_setup_pending";
  }
  if (adminPhase === "administrator_ready") {
    return input.status.humanUserCount > 0
      ? "installation_ready"
      : "administrator_active";
  }
  return "recovery_required";
}

export function parseInstallationStatusJson(
  stdout: string,
): InstallationStatusSnapshot {
  const trimmed = stdout.trim();
  const jsonLine =
    trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("{")) ?? trimmed;
  const parsed = JSON.parse(jsonLine) as InstallationStatusSnapshot;
  if (parsed.schemaVersion !== 1) {
    throw new Error(
      `Unsupported installation status schema version ${String(parsed.schemaVersion)}.`,
    );
  }
  return parsed;
}

export function classifyAdministratorBootstrapPhase(
  status: InstallationStatusSnapshot,
): AdministratorBootstrapPhase {
  if (status.organizationCount > 0) {
    if (status.pendingSetupUserCount > 0) {
      return "administrator_pending_password_setup";
    }
    if (status.humanUserCount > 0) {
      return "administrator_ready";
    }
  }

  if (status.unlinkedWorkspaceIds.length === 0 && status.workspaceCount > 0) {
    return "administrator_ready";
  }

  if (status.unlinkedWorkspaceIds.length > 1) {
    return "multiple_unlinked_workspaces";
  }

  if (status.unlinkedWorkspaceIds.length === 1) {
    return "workspace_without_human_administrator";
  }

  if (status.workspaceCount === 0) {
    return "fresh_installation";
  }

  if (
    status.workspaceCount > 0 &&
    status.organizationCount === 0 &&
    status.unlinkedWorkspaceIds.length === 0 &&
    status.humanUserCount === 0
  ) {
    return "ambiguous_workspace_state";
  }

  return "ambiguous_workspace_state";
}
