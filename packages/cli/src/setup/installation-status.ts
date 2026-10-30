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

  if (status.workspaceCount === 0 && status.apiKeyCount === 0) {
    return "fresh_installation";
  }

  return "ambiguous_workspace_state";
}
