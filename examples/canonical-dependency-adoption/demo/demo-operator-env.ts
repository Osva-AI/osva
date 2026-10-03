import {
  OperatorConfigurationError,
  type OperatorEnv,
} from "../scripts/lib/operator-env.js";
import { readCanonicalState } from "../scripts/lib/state.js";
import { normalizeWorkspaceId } from "./canonical-readiness.js";

/**
 * Demo server operator env: OSVA_BASE_URL and OSVA_API_KEY are always required.
 * When canonical-state.json exists, its workspaceId is authoritative for demo
 * operations. OSVA_WORKSPACE_ID is optional in that case; if set, it must match
 * the state file (after normalization).
 */
export async function loadDemoServerOperatorEnv(): Promise<OperatorEnv> {
  const baseUrl = process.env.OSVA_BASE_URL?.trim();
  const apiKey = process.env.OSVA_API_KEY?.trim();
  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new OperatorConfigurationError(
      "Missing OSVA_BASE_URL. Set this before running the canonical demo server.",
    );
  }
  if (apiKey === undefined || apiKey.length === 0) {
    throw new OperatorConfigurationError(
      "Missing OSVA_API_KEY. Set this before running the canonical demo server.",
    );
  }

  const state = await readCanonicalState();
  const configuredWorkspace = process.env.OSVA_WORKSPACE_ID?.trim();

  if (state !== null) {
    const stateWorkspace = normalizeWorkspaceId(state.workspaceId);
    if (configuredWorkspace !== undefined && configuredWorkspace.length > 0) {
      const envWorkspace = normalizeWorkspaceId(configuredWorkspace);
      if (envWorkspace !== stateWorkspace) {
        throw new OperatorConfigurationError(
          "OSVA_WORKSPACE_ID does not match canonical-state.json workspaceId.",
        );
      }
    }
    return {
      baseUrl,
      apiKey,
      workspaceId: stateWorkspace,
      requestTimeoutMs: 120_000,
    };
  }

  if (configuredWorkspace === undefined || configuredWorkspace.length === 0) {
    throw new OperatorConfigurationError(
      "Missing OSVA_WORKSPACE_ID and canonical-state.json was not found.",
    );
  }

  return {
    baseUrl,
    apiKey,
    workspaceId: normalizeWorkspaceId(configuredWorkspace),
    requestTimeoutMs: 120_000,
  };
}
