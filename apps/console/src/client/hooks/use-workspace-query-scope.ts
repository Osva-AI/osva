import { useSyncExternalStore } from "react";

import { getSelectedWorkspaceId } from "../lib/workspace-selection";

function subscribe(onStoreChange: () => void): () => void {
  const handler = (): void => {
    onStoreChange();
  };
  window.addEventListener("storage", handler);
  window.addEventListener("osva-workspace-selected", handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("osva-workspace-selected", handler);
  };
}

export function useWorkspaceQueryScope(): string | undefined {
  return useSyncExternalStore(
    subscribe,
    getSelectedWorkspaceId,
    () => undefined,
  );
}
