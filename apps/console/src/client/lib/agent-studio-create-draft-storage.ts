import type { AgentStudioV2StageId } from "./agent-studio-v2-stages";

const STORAGE_VERSION = 1 as const;

export interface AgentStudioCreateDraft {
  readonly agentName: string;
  readonly manifestText: string;
  readonly editorMode: "guided" | "advanced";
  readonly stage: AgentStudioV2StageId;
}

interface StoredAgentStudioCreateEnvelope {
  readonly version: typeof STORAGE_VERSION;
  readonly draft: AgentStudioCreateDraft;
}

export function agentStudioCreateStorageKey(workspaceId: string): string {
  return `osva.console.agent-studio-create.v${STORAGE_VERSION}:${workspaceId}`;
}

export function readAgentStudioCreateDraft(
  workspaceId: string,
): AgentStudioCreateDraft | undefined {
  if (typeof sessionStorage === "undefined" || workspaceId.length === 0) {
    return undefined;
  }
  const raw = sessionStorage.getItem(agentStudioCreateStorageKey(workspaceId));
  if (raw === null || raw.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as StoredAgentStudioCreateEnvelope;
    if (parsed.version !== STORAGE_VERSION) {
      return undefined;
    }
    if (
      typeof parsed.draft.agentName !== "string" ||
      typeof parsed.draft.manifestText !== "string" ||
      (parsed.draft.editorMode !== "guided" &&
        parsed.draft.editorMode !== "advanced") ||
      !isRestorableStage(parsed.draft.stage)
    ) {
      return undefined;
    }
    return parsed.draft;
  } catch {
    return undefined;
  }
}

export function writeAgentStudioCreateDraft(
  workspaceId: string,
  draft: AgentStudioCreateDraft,
): void {
  if (typeof sessionStorage === "undefined" || workspaceId.length === 0) {
    return;
  }
  const envelope: StoredAgentStudioCreateEnvelope = {
    version: STORAGE_VERSION,
    draft,
  };
  sessionStorage.setItem(
    agentStudioCreateStorageKey(workspaceId),
    JSON.stringify(envelope),
  );
}

export function clearAgentStudioCreateDraft(workspaceId: string): void {
  if (typeof sessionStorage === "undefined" || workspaceId.length === 0) {
    return;
  }
  sessionStorage.removeItem(agentStudioCreateStorageKey(workspaceId));
}

function isRestorableStage(
  stage: AgentStudioV2StageId,
): stage is "describe" | "equip" | "review" {
  return stage === "describe" || stage === "equip" || stage === "review";
}
