import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentVersionId, WorkflowDefinitionV3 } from "@osva-ai/contracts";
import { workflowDefinitionSchema } from "@osva-ai/contracts/schemas";

const PLACEHOLDER_RESEARCH = "<researchAgentVersionId>";
const PLACEHOLDER_ANALYSIS = "<analysisAgentVersionId>";
const PLACEHOLDER_REPORT = "<reportAgentVersionId>";

export const testAgentVersionIds = {
  research: "agent-version-canonical-research" as AgentVersionId,
  analysis: "agent-version-canonical-analysis" as AgentVersionId,
  report: "agent-version-canonical-report" as AgentVersionId,
} as const;

export function loadReferenceWorkflowDefinitionRaw(): unknown {
  const workflowPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "workflow",
    "dependency-adoption.v3.json",
  );
  return JSON.parse(readFileSync(workflowPath, "utf8")) as unknown;
}

export function materializeReferenceWorkflowDefinition(): WorkflowDefinitionV3 {
  const serialized = JSON.stringify(loadReferenceWorkflowDefinitionRaw())
    .replaceAll(PLACEHOLDER_RESEARCH, testAgentVersionIds.research)
    .replaceAll(PLACEHOLDER_ANALYSIS, testAgentVersionIds.analysis)
    .replaceAll(PLACEHOLDER_REPORT, testAgentVersionIds.report);

  const parsed = workflowDefinitionSchema.parse(JSON.parse(serialized));
  if (parsed.schemaVersion !== "3") {
    throw new Error("Expected schemaVersion 3 after materialization.");
  }
  return parsed;
}
