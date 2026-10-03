import type { WorkflowId, WorkflowVersionId } from "@osva-ai/contracts";
import { OsvaApiError } from "@osva-ai/sdk";

import type { OperatorApi } from "../scripts/lib/operator-client.js";
import type { CanonicalStateV1 } from "../scripts/lib/state.js";
import { readCanonicalState } from "../scripts/lib/state.js";

export const CANONICAL_STATE_RELATIVE_PATH = ".osva/canonical-state.json";

export type CanonicalDemoNotReadyReason =
  | "STATE_FILE_MISSING"
  | "WORKSPACE_ID_MISMATCH"
  | "WORKFLOW_PIN_INCOMPLETE"
  | "WORKFLOW_VERSION_MISSING"
  | "CANONICAL_SETUP_STALE";

export interface CanonicalDemoReadyResponse {
  readonly ready: true;
  readonly schemaVersion: CanonicalStateV1["schemaVersion"];
  readonly workspaceId: string;
  readonly workflowId: string;
  readonly workflowVersionId: string;
  readonly knowledgeIndexId: string;
  readonly agents: {
    readonly research: { readonly agentId: string };
    readonly analysis: { readonly agentId: string };
    readonly report: { readonly agentId: string };
  };
}

export interface CanonicalDemoNotReadyResponse {
  readonly ready: false;
  readonly reason: CanonicalDemoNotReadyReason;
  readonly message?: string;
}

export type CanonicalDemoReadinessResponse =
  CanonicalDemoReadyResponse | CanonicalDemoNotReadyResponse;

export function normalizeWorkspaceId(workspaceId: string): string {
  return workspaceId.trim().replace(/^\uFEFF/, "");
}

export function safeCanonicalReadyPayload(
  state: CanonicalStateV1,
): CanonicalDemoReadyResponse {
  return {
    ready: true,
    schemaVersion: state.schemaVersion,
    workspaceId: normalizeWorkspaceId(state.workspaceId),
    workflowId: state.workflowId,
    workflowVersionId: state.workflowVersionId,
    knowledgeIndexId: state.knowledgeIndexId,
    agents: {
      research: { agentId: state.agents.research.agentId },
      analysis: { agentId: state.agents.analysis.agentId },
      report: { agentId: state.agents.report.agentId },
    },
  };
}

export interface EvaluateCanonicalDemoReadinessInput {
  readonly configuredWorkspaceId: string;
  readonly state?: CanonicalStateV1 | null;
  readonly verifyWorkflowVersion?: (
    workflowId: WorkflowId,
    workflowVersionId: WorkflowVersionId,
  ) => Promise<void>;
}

export async function evaluateCanonicalDemoReadiness(
  input: EvaluateCanonicalDemoReadinessInput,
): Promise<CanonicalDemoReadinessResponse> {
  const state =
    input.state !== undefined ? input.state : await readCanonicalState();
  if (state === null) {
    return {
      ready: false,
      reason: "STATE_FILE_MISSING",
      message: `Canonical setup state was not found at ${CANONICAL_STATE_RELATIVE_PATH}.`,
    };
  }

  const stateWorkspace = normalizeWorkspaceId(state.workspaceId);
  const envWorkspace = normalizeWorkspaceId(input.configuredWorkspaceId);
  if (envWorkspace !== stateWorkspace) {
    return {
      ready: false,
      reason: "WORKSPACE_ID_MISMATCH",
      message:
        "OSVA_WORKSPACE_ID does not match workspaceId in canonical-state.json.",
    };
  }

  if (
    state.workflowId.trim().length === 0 ||
    state.workflowVersionId.trim().length === 0
  ) {
    return {
      ready: false,
      reason: "WORKFLOW_PIN_INCOMPLETE",
      message:
        "canonical-state.json is missing workflowId or workflowVersionId.",
    };
  }

  if (input.verifyWorkflowVersion !== undefined) {
    try {
      await input.verifyWorkflowVersion(
        state.workflowId as WorkflowId,
        state.workflowVersionId as WorkflowVersionId,
      );
    } catch (error) {
      if (error instanceof OsvaApiError && error.status === 404) {
        return {
          ready: false,
          reason: "WORKFLOW_VERSION_MISSING",
          message:
            "Pinned workflow version is not available in OSVA for this workspace.",
        };
      }
      throw error;
    }
  }

  return safeCanonicalReadyPayload(state);
}

export async function evaluateCanonicalDemoReadinessWithApi(
  api: OperatorApi,
  configuredWorkspaceId: string,
): Promise<CanonicalDemoReadinessResponse> {
  return evaluateCanonicalDemoReadiness({
    configuredWorkspaceId,
    verifyWorkflowVersion: async (workflowId, workflowVersionId) => {
      await api.sdk.workflows.getVersion(workflowId, workflowVersionId);
    },
  });
}
