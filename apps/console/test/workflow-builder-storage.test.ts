import { afterEach, describe, expect, it } from "vitest";

import {
  addAgentNode,
  createEmptyWorkflowBuilderDraft,
} from "../src/client/lib/workflow-builder-linear";
import {
  clearStoredWorkflowBuilderDraft,
  draftsConflict,
  readStoredWorkflowBuilderDraft,
  workflowBuilderStorageKey,
  writeStoredWorkflowBuilderDraft,
} from "../src/client/lib/workflow-builder-storage";

describe("workflow builder session storage", () => {
  afterEach(() => {
    clearStoredWorkflowBuilderDraft("ws-a");
    clearStoredWorkflowBuilderDraft("ws-b");
  });

  it("scopes storage by workspace and avoids cross-workspace reads", () => {
    const draftA = addAgentNode(createEmptyWorkflowBuilderDraft("ws-a"));
    writeStoredWorkflowBuilderDraft(draftA);
    expect(readStoredWorkflowBuilderDraft("ws-b")).toBeUndefined();
    const loaded = readStoredWorkflowBuilderDraft("ws-a");
    expect(loaded?.envelope.draft.draftId).toBe(draftA.draftId);
  });

  it("detects draft conflicts without overwriting", () => {
    const stored = addAgentNode(createEmptyWorkflowBuilderDraft("ws-a"));
    const active = createEmptyWorkflowBuilderDraft("ws-a");
    expect(draftsConflict(active.draftId, { version: 1, draft: stored })).toBe(
      true,
    );
    expect(draftsConflict(stored.draftId, { version: 1, draft: stored })).toBe(
      false,
    );
  });

  it("does not store API key material", () => {
    const draft = createEmptyWorkflowBuilderDraft("ws-a");
    writeStoredWorkflowBuilderDraft(draft);
    const raw = sessionStorage.getItem(workflowBuilderStorageKey("ws-a"));
    expect(raw).not.toBeNull();
    expect(raw!).not.toMatch(/api[_-]?key/i);
    expect(raw!).not.toContain("Bearer");
  });
});
