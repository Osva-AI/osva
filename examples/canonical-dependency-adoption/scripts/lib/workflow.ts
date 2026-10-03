import { readFile } from "node:fs/promises";

import type { AgentVersionId, WorkflowDefinitionV3 } from "@osva-ai/contracts";
import { workflowDefinitionSchema } from "@osva-ai/contracts/schemas";

import { workflowReferencePath } from "./paths.js";

export interface WorkflowAgentVersionIds {
  readonly research: AgentVersionId;
  readonly analysis: AgentVersionId;
  readonly report: AgentVersionId;
}

export async function loadReferenceWorkflowDefinition(): Promise<unknown> {
  const raw = await readFile(workflowReferencePath, "utf8");
  return JSON.parse(raw) as unknown;
}

export function materializeWorkflowDefinition(
  reference: unknown,
  agentVersionIds: WorkflowAgentVersionIds,
): WorkflowDefinitionV3 {
  const serialized = JSON.stringify(reference)
    .replaceAll("<researchAgentVersionId>", agentVersionIds.research)
    .replaceAll("<analysisAgentVersionId>", agentVersionIds.analysis)
    .replaceAll("<reportAgentVersionId>", agentVersionIds.report);

  const parsed = workflowDefinitionSchema.parse(JSON.parse(serialized));
  if (parsed.schemaVersion !== "3") {
    throw new Error("Canonical workflow definition must be schemaVersion 3.");
  }
  return parsed;
}
