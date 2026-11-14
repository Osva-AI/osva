import { TOOL_ERROR_CODES } from "@osva-ai/contracts";

import type { RunStepResource } from "../hooks/use-runs";
import type { OperatorGuidance } from "./operator-diagnostics";

export type RunAttemptExecutionState =
  | "queued"
  | "running_leased"
  | "running_lease_expired"
  | "running_unleased"
  | "interrupted"
  | "failed"
  | "completed"
  | "cancelled"
  | "timed_out";

export interface RunAttemptExecutionDiagnostics {
  readonly state: RunAttemptExecutionState | string;
  readonly leased: boolean;
  readonly leaseExpiresAt?: string;
  readonly executionGeneration: number;
  readonly interrupted: boolean;
  readonly recoveryReason?: string;
  readonly observedAt: string;
}

const STATE_LABELS: Readonly<Record<string, string>> = {
  queued: "Queued",
  running_leased: "Running with an active lease",
  running_lease_expired: "Running but lease expired",
  running_unleased: "Running (no execution lease)",
  interrupted: "Execution interrupted",
  failed: "Failed",
  completed: "Completed",
  cancelled: "Cancelled",
  timed_out: "Timed out",
};

export function executionStateLabel(state: string): string {
  return STATE_LABELS[state] ?? state;
}

export interface RunStepToolDiagnosticsView {
  readonly bindingName: string;
  readonly toolVersionId?: string;
  readonly statusLabel: string;
  readonly errorCode?: string;
  readonly guidance?: OperatorGuidance;
}

export function describeRunStepToolErrorGuidance(
  errorCode: string | undefined,
): OperatorGuidance | undefined {
  if (errorCode === undefined || errorCode.trim().length === 0) {
    return undefined;
  }
  const code = errorCode.trim();

  if (code === TOOL_ERROR_CODES.TOOL_NOT_AUTHORIZED) {
    return {
      title: "Tool authorization denied",
      explanation:
        "ToolGateway rejected this invocation for the frozen AgentVersion binding or workspace policy.",
      nextSteps: [
        "Confirm the binding name on this RunStep matches a toolVersionBindings entry on the AgentVersion.",
        "Navigation hints and catalog metadata do not grant permissions.",
        "Publish a new AgentVersion if bindings must change — published versions are immutable.",
      ],
      severity: "error",
      recoverable: true,
    };
  }

  if (
    code === TOOL_ERROR_CODES.TOOL_VERSION_NOT_FOUND ||
    code === TOOL_ERROR_CODES.TOOL_BINDING_NOT_FOUND
  ) {
    return {
      title: "Missing ToolVersion or binding",
      explanation:
        "The worker could not resolve the ToolVersion or logical binding for this call.",
      nextSteps: [
        "Verify the AgentVersion manifest lists the ToolVersion id and binding name used at run time.",
        "Confirm the ToolVersion still exists in this workspace.",
      ],
      severity: "error",
      recoverable: true,
    };
  }

  if (code === TOOL_ERROR_CODES.CONNECTOR_UNAVAILABLE) {
    return {
      title: "Connector unreachable",
      explanation:
        "The MCP connector transport could not be reached from the worker.",
      nextSteps: [
        "Confirm ConnectorVersion transport configuration on the worker.",
        "STDIO connectors require operator provisioning when the STDIO gate is enabled.",
        "This Console view does not prove provider network health.",
      ],
      severity: "error",
      recoverable: true,
    };
  }

  if (code === TOOL_ERROR_CODES.CONNECTOR_AUTHENTICATION_FAILED) {
    return {
      title: "Provider authentication failure",
      explanation:
        "The connector rejected authentication. Secret values are never displayed in Console.",
      nextSteps: [
        "Verify secret reference keys on the ConnectorVersion resolve on the worker.",
        "Append a new ConnectorVersion if credential references changed.",
      ],
      severity: "error",
      recoverable: true,
    };
  }

  if (code === TOOL_ERROR_CODES.CONNECTOR_TIMEOUT) {
    return {
      title: "Connector timeout",
      explanation:
        "The MCP call exceeded the connector timeout without a terminal provider response.",
      nextSteps: [
        "Retry with a new Run when the provider is healthy.",
        "Inspect other Tool RunSteps for earlier failures.",
      ],
      severity: "warning",
      recoverable: true,
    };
  }

  if (
    code === TOOL_ERROR_CODES.MCP_PROTOCOL_ERROR ||
    code === TOOL_ERROR_CODES.MCP_UNSUPPORTED_INTERACTION
  ) {
    return {
      title: "MCP protocol error",
      explanation:
        "The MCP session failed at the protocol layer. Raw provider payloads are not shown here.",
      nextSteps: [
        "Confirm ConnectorVersion transport matches the provider MCP implementation.",
        "Use connector discovery in Integrations to validate remote tool metadata separately from execution.",
      ],
      severity: "error",
      recoverable: true,
    };
  }

  if (code === TOOL_ERROR_CODES.MCP_TOOL_NOT_FOUND) {
    return {
      title: "MCP tool not found",
      explanation:
        "The remote MCP server did not expose the tool name bound on this ToolVersion.",
      nextSteps: [
        "Re-run discovery and confirm the remote tool name matches the imported ToolVersion.",
        "Import creates a new ToolVersion when remote definitions change.",
      ],
      severity: "error",
      recoverable: true,
    };
  }

  if (
    code === TOOL_ERROR_CODES.MCP_TOOL_ERROR ||
    code === TOOL_ERROR_CODES.TOOL_EXECUTION_ERROR
  ) {
    return {
      title: "MCP tool invocation error",
      explanation:
        "The provider reported a tool-level failure. OSVA stores only the sanitized error code.",
      nextSteps: [
        "Adjust run input or tool arguments if INVALID_TOOL_INPUT or MCP_INVALID_ARGUMENTS appear on related steps.",
        "Do not treat generic failure text as a specific root cause.",
      ],
      severity: "error",
      recoverable: true,
    };
  }

  if (
    code === TOOL_ERROR_CODES.INVALID_TOOL_INPUT ||
    code === TOOL_ERROR_CODES.MCP_INVALID_ARGUMENTS
  ) {
    return {
      title: "Invalid tool input",
      explanation:
        "The tool call arguments did not satisfy the ToolVersion input schema.",
      nextSteps: [
        "Inspect the agent prompt and run input that produced this call.",
        "Open the Tool detail page to review the imported input schema.",
      ],
      severity: "error",
      recoverable: true,
    };
  }

  if (code.startsWith("MCP_") || code.startsWith("CONNECTOR_")) {
    return {
      title: "Connector execution failure",
      explanation:
        "Tool execution failed while calling an MCP connector. The error code above is authoritative.",
      nextSteps: [
        "Review connector configuration and worker logs using operator tooling.",
        "See Integrations for discovery and import — not for live execution authorization.",
      ],
      severity: "error",
      recoverable: true,
    };
  }

  return undefined;
}

export function buildRunStepToolDiagnosticsView(
  step: RunStepResource,
): RunStepToolDiagnosticsView | undefined {
  if (step.kind !== "TOOL") {
    return undefined;
  }
  const guidance = describeRunStepToolErrorGuidance(step.errorCode);
  return {
    bindingName: step.bindingName,
    toolVersionId: step.toolVersionId,
    statusLabel: step.status,
    errorCode: step.errorCode,
    guidance,
  };
}
