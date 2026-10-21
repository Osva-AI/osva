import { afterEach, describe, expect, it } from "vitest";

import {
  addAgentNode,
  createEmptyWorkflowBuilderDraft,
} from "../src/client/lib/workflow-builder-linear";
import { createDraftForNewWorkflowVersion } from "../src/client/lib/workflow-builder-clone";
import {
  draftsConflict,
  readStoredWorkflowBuilderDraft,
  workflowBuilderStorageKey,
  writeStoredWorkflowBuilderDraft,
} from "../src/client/lib/workflow-builder-storage";

describe("workflow builder session storage", () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it("scopes storage by workspace and avoids cross-workspace reads", () => {
    const draftA = addAgentNode(createEmptyWorkflowBuilderDraft("ws-a"));
    writeStoredWorkflowBuilderDraft(draftA);
    expect(
      readStoredWorkflowBuilderDraft(
        "ws-b",
        createEmptyWorkflowBuilderDraft("ws-b"),
      ),
    ).toBeUndefined();
    const loaded = readStoredWorkflowBuilderDraft("ws-a", draftA);
    expect(loaded?.envelope.draft.draftId).toBe(draftA.draftId);
  });

  it("isolates create drafts from new-version drafts", () => {
    const createDraft = createEmptyWorkflowBuilderDraft("ws-a");
    const versionDraft = createDraftForNewWorkflowVersion({
      workspaceId: "ws-a",
      createdWorkflowId: "wf-1",
      sourceVersionId: "ver-1",
      registry: { key: "demo", name: "Demo" },
      definition: { schemaVersion: "3", nodes: [], edges: [] },
    });
    writeStoredWorkflowBuilderDraft(createDraft);
    expect(
      readStoredWorkflowBuilderDraft("ws-a", versionDraft),
    ).toBeUndefined();
  });

  it("detects draft conflicts without overwriting", () => {
    const stored = addAgentNode(createEmptyWorkflowBuilderDraft("ws-a"));
    const active = createEmptyWorkflowBuilderDraft("ws-a");
    expect(draftsConflict(active.draftId, { version: 2, draft: stored })).toBe(
      true,
    );
    expect(draftsConflict(stored.draftId, { version: 2, draft: stored })).toBe(
      false,
    );
  });

  it("does not store API key material", () => {
    const draft = createEmptyWorkflowBuilderDraft("ws-a");
    writeStoredWorkflowBuilderDraft(draft);
    const raw = sessionStorage.getItem(
      workflowBuilderStorageKey("ws-a", draft),
    );
    expect(raw).not.toBeNull();
    expect(raw!).not.toMatch(/api[_-]?key/i);
    expect(raw!).not.toContain("Bearer");
  });
});
