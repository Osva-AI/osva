import type { WorkflowBuilderDraft } from "./workflow-builder-draft";
import { draftStorageScopeKey } from "./workflow-builder-storage-scope";

const STORAGE_VERSION = 2 as const;

export interface StoredWorkflowBuilderEnvelope {
  readonly version: typeof STORAGE_VERSION;
  readonly draft: WorkflowBuilderDraft;
}

export interface StoredDraftLookup {
  readonly envelope: StoredWorkflowBuilderEnvelope;
  readonly storageKey: string;
}

export function workflowBuilderStorageKey(
  workspaceId: string,
  draft: WorkflowBuilderDraft,
): string {
  return `osva.console.workflow-builder.v${STORAGE_VERSION}:${workspaceId}:${draftStorageScopeKey(draft)}`;
}

export function readStoredWorkflowBuilderDraft(
  workspaceId: string,
  draft: WorkflowBuilderDraft,
): StoredDraftLookup | undefined {
  if (typeof sessionStorage === "undefined") {
    return undefined;
  }
  const storageKey = workflowBuilderStorageKey(workspaceId, draft);
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
    if (draftStorageScopeKey(parsed.draft) !== draftStorageScopeKey(draft)) {
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
  const storageKey = workflowBuilderStorageKey(draft.workspaceId, draft);
  const envelope: StoredWorkflowBuilderEnvelope = {
    version: STORAGE_VERSION,
    draft,
  };
  sessionStorage.setItem(storageKey, JSON.stringify(envelope));
}

export function clearStoredWorkflowBuilderDraft(
  workspaceId: string,
  draft: WorkflowBuilderDraft,
): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  sessionStorage.removeItem(workflowBuilderStorageKey(workspaceId, draft));
}

export function draftsConflict(
  activeDraftId: string,
  stored: StoredWorkflowBuilderEnvelope,
): boolean {
  return stored.draft.draftId !== activeDraftId;
}
