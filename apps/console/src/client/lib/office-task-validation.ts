import type { AgentVersionResource } from "../hooks/use-agents";
import type { WorkflowVersionResource } from "../hooks/use-workflows";

export type ParsedOfficeTaskInput =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

export function parseOfficeTaskInputJson(text: string): ParsedOfficeTaskInput {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      message: "Task input is required. Use {} for empty input.",
    };
  }

  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof SyntaxError
          ? error.message
          : "Task input must be valid JSON.",
    };
  }
}

export function agentVersionsForWorker(
  agentId: string,
  versions: readonly AgentVersionResource[],
): readonly AgentVersionResource[] {
  if (agentId.length === 0) {
    return [];
  }
  return versions.filter((version) => version.agentId === agentId);
}

export function workflowVersionsForWorkspace(
  versions: readonly WorkflowVersionResource[],
  workspaceId: string,
): readonly WorkflowVersionResource[] {
  return versions.filter((version) => version.workspaceId === workspaceId);
}

export function isAgentVersionCompatibleWithWorker(
  agentVersionId: string,
  workerAgentId: string,
  versions: readonly AgentVersionResource[],
): boolean {
  const match = versions.find((version) => version.id === agentVersionId);
  return match !== undefined && match.agentId === workerAgentId;
}

export function isWorkflowVersionSelectable(
  workflowVersionId: string,
  workspaceId: string,
  versions: readonly WorkflowVersionResource[],
): boolean {
  const match = versions.find((version) => version.id === workflowVersionId);
  return match !== undefined && match.workspaceId === workspaceId;
}
