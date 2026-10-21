import type { WorkflowBuilderDraft } from "./workflow-builder-draft";

export function draftStorageScopeKey(draft: WorkflowBuilderDraft): string {
  const context = draft.editContext ?? { kind: "create" as const };
  if (context.kind === "create") {
    return "create";
  }
  return `newVersion:${context.workflowId}:${context.sourceVersionId}`;
}
