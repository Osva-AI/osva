const STORAGE_KEY = "osva.console.selectedWorkspaceId";

export function getSelectedWorkspaceId(): string | undefined {
  if (typeof sessionStorage === "undefined") {
    return undefined;
  }
  const raw = sessionStorage.getItem(STORAGE_KEY)?.trim() ?? "";
  return raw.length > 0 ? raw : undefined;
}

export function setSelectedWorkspaceId(workspaceId: string): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  sessionStorage.setItem(STORAGE_KEY, workspaceId);
}

export function clearSelectedWorkspaceId(): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  sessionStorage.removeItem(STORAGE_KEY);
}

export function reconcileSelectedWorkspace(
  authorizedWorkspaceIds: readonly string[],
): string | undefined {
  const selected = getSelectedWorkspaceId();
  if (selected === undefined) {
    return undefined;
  }
  if (!authorizedWorkspaceIds.includes(selected)) {
    clearSelectedWorkspaceId();
    return undefined;
  }
  return selected;
}
