import type { WorkflowDefinitionV3 } from "@osva-ai/contracts";
import { workflowDefinitionSchema } from "@osva-ai/contracts/schemas";

import {
  analyzeWorkflowBuilderDraft,
  applyCanonicalPublishGate,
  type WorkflowBuilderValidationReport,
} from "./workflow-builder-validation";

export interface WorkflowNodeLayout {
  readonly x: number;
  readonly y: number;
}

export interface WorkflowBuilderRegistry {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
}

export interface WorkflowBuilderDraft {
  readonly draftId: string;
  readonly workspaceId: string;
  readonly registry: WorkflowBuilderRegistry;
  readonly definition: WorkflowDefinitionV3;
  readonly layoutByNodeKey: Readonly<Record<string, WorkflowNodeLayout>>;
  /** Legacy linear authoring order (M8.3.1); not used for graph validation. */
  readonly nodeOrder: readonly string[];
  readonly nextNodeSequence: number;
  readonly createdWorkflowId?: string;
}

export function createDraftId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `draft-${String(Date.now())}`;
}

export function createEmptyWorkflowBuilderDraft(
  workspaceId: string,
): WorkflowBuilderDraft {
  return {
    draftId: createDraftId(),
    workspaceId,
    registry: { key: "", name: "" },
    definition: { schemaVersion: "3", nodes: [], edges: [] },
    layoutByNodeKey: {},
    nodeOrder: [],
    nextNodeSequence: 1,
  };
}

export function updateRegistry(
  draft: WorkflowBuilderDraft,
  registry: WorkflowBuilderRegistry,
): WorkflowBuilderDraft {
  return { ...draft, registry };
}

export function setCreatedWorkflowId(
  draft: WorkflowBuilderDraft,
  createdWorkflowId: string,
): WorkflowBuilderDraft {
  return { ...draft, createdWorkflowId };
}

export function definitionForPublish(
  draft: WorkflowBuilderDraft,
): WorkflowDefinitionV3 {
  return {
    schemaVersion: "3",
    nodes: draft.definition.nodes,
    edges: draft.definition.edges,
  };
}

export function assertNoLayoutInDefinition(
  definition: WorkflowDefinitionV3,
): void {
  const serialized = JSON.stringify(definition);
  if (serialized.includes("layoutByNodeKey")) {
    throw new Error("Layout must not appear in persisted workflow definition.");
  }
}

export interface ClientDefinitionValidation {
  readonly ok: true;
  readonly definition: WorkflowDefinitionV3;
  readonly report: WorkflowBuilderValidationReport;
}

export interface ClientDefinitionValidationError {
  readonly ok: false;
  readonly message: string;
  readonly report: WorkflowBuilderValidationReport;
}

export function validateRegistryFields(
  registry: WorkflowBuilderRegistry,
): string | undefined {
  if (registry.key.trim().length === 0) {
    return "Workflow key is required.";
  }
  if (registry.name.trim().length === 0) {
    return "Workflow name is required.";
  }
  return undefined;
}

export function validateDraftForPublish(
  draft: WorkflowBuilderDraft,
): ClientDefinitionValidation | ClientDefinitionValidationError {
  const guidance = analyzeWorkflowBuilderDraft(draft);
  const report = applyCanonicalPublishGate(draft, guidance);
  if (report.errorCount > 0) {
    return {
      ok: false,
      message: report.issues[0]?.message ?? "Workflow definition is invalid.",
      report,
    };
  }

  const definition = definitionForPublish(draft);
  const parsed = workflowDefinitionSchema.parse(definition);
  if (parsed.schemaVersion !== "3") {
    return {
      ok: false,
      message: "Workflow builder requires schema version 3.",
      report,
    };
  }
  return { ok: true, definition: parsed, report };
}
