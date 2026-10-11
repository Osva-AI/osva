import type { WorkflowBuilderDraft } from "./workflow-builder-linear";

const STORAGE_VERSION = 1 as const;

export interface StoredWorkflowBuilderEnvelope {
  readonly version: typeof STORAGE_VERSION;
  readonly draft: WorkflowBuilderDraft;
}

export interface StoredDraftLookup {
  readonly envelope: StoredWorkflowBuilderEnvelope;
  readonly storageKey: string;
}

export function workflowBuilderStorageKey(workspaceId: string): string {
  return `osva.console.workflow-builder.v${STORAGE_VERSION}:${workspaceId}`;
}

export function readStoredWorkflowBuilderDraft(
  workspaceId: string,
): StoredDraftLookup | undefined {
  if (typeof sessionStorage === "undefined") {
    return undefined;
  }
  const storageKey = workflowBuilderStorageKey(workspaceId);
  const raw = sessionStorage.getItem(storageKey);
  if (raw === null || raw.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as StoredWorkflowBuilderEnvelope;
    if (parsed.version !== STORAGE_VERSION) {
      return undefined;
    }
    if (parsed.draft.workspaceId !== workspaceId) {
      return undefined;
    }
    return { envelope: parsed, storageKey };
  } catch {
    return undefined;
  }
}

export function writeStoredWorkflowBuilderDraft(
  draft: WorkflowBuilderDraft,
): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  const storageKey = workflowBuilderStorageKey(draft.workspaceId);
  const envelope: StoredWorkflowBuilderEnvelope = {
    version: STORAGE_VERSION,
    draft,
  };
  sessionStorage.setItem(storageKey, JSON.stringify(envelope));
}

export function clearStoredWorkflowBuilderDraft(workspaceId: string): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  sessionStorage.removeItem(workflowBuilderStorageKey(workspaceId));
}

export function draftsConflict(
  activeDraftId: string,
  stored: StoredWorkflowBuilderEnvelope,
): boolean {
  return stored.draft.draftId !== activeDraftId;
}
