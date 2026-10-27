import { ConsoleApiError } from "./console-api.js";
import type { RunAttemptExecutionDiagnostics } from "./execution-diagnostics.js";

export type OperatorGuidanceSeverity = "info" | "warning" | "error";

export interface OperatorGuidance {
  readonly title: string;
  readonly explanation: string;
  readonly nextSteps: readonly string[];
  readonly severity: OperatorGuidanceSeverity;
  /** When false, the same RunAttempt or WorkflowRun cannot be resumed automatically. */
  readonly recoverable?: boolean;
}

export function describeHttpStatusGuidance(
  status: number,
  context:
    | "create_run"
    | "generic"
    | "connector_discover"
    | "connector_import"
    | "model_connectivity",
): OperatorGuidance | undefined {
  if (status === 429) {
    return {
      title: "Rate limited",
      explanation:
        "The control plane rejected this request because an authenticated rate limit was exceeded.",
      nextSteps: [
        "Wait before retrying. The Console does not automatically retry rate-limited mutations.",
        "Reduce parallel launches or bulk API calls from scripts hitting the same workspace.",
      ],
      severity: "warning",
      recoverable: true,
    };
  }

  if (status === 503) {
    const dependencyHint =
      context === "generic"
        ? "Check GET /ready on the control plane for postgres or valkey dependency failures."
        : "Confirm the control plane is reachable and GET /ready returns 200 before retrying.";
    return {
      title: "Service unavailable",
      explanation:
        "The control plane or an upstream dependency could not satisfy this request.",
      nextSteps: [
        dependencyHint,
        "See the OSVA operations runbook (health endpoints and dependency recovery).",
      ],
      severity: "error",
      recoverable: true,
    };
  }

  switch (context) {
    case "create_run":
      if (status === 400) {
        return {
          title: "Invalid run request",
          explanation:
            "The control plane rejected this launch as invalid before queueing execution.",
          nextSteps: [
            "Verify AgentVersion identity and JSON input shape.",
            "Inspect the persisted Run only after a successful 201 response.",
          ],
          severity: "error",
          recoverable: true,
        };
      }
      if (status === 403) {
        return {
          title: "Execute permission required",
          explanation:
            "This human session cannot start Runs in the selected workspace.",
          nextSteps: [
            "Use an OPERATOR, EDITOR, or ADMIN membership for EXECUTE actions.",
            "Workspace ID selection in the Console is not authorization.",
          ],
          severity: "error",
          recoverable: true,
        };
      }
      if (status === 404) {
        return {
          title: "Agent or version not found",
          explanation:
            "The Agent or AgentVersion is not visible in the authenticated workspace.",
          nextSteps: [
            "Confirm the selected workspace matches where the Agent was registered.",
            "Open the AgentVersion page to verify the immutable version id.",
          ],
          severity: "error",
          recoverable: true,
        };
      }
      if (status === 409) {
        return {
          title: "Conflict",
          explanation:
            "The control plane reported a conflict while creating the Run.",
          nextSteps: [
            "A Run with the same idempotency key may already exist.",
            "Open Runs list and search for an existing Run before retrying.",
          ],
          severity: "warning",
          recoverable: true,
        };
      }
      return undefined;
    case "connector_discover":
    case "connector_import":
      if (status === 403) {
        return {
          title: "Write permission required",
          explanation:
            "Connector discovery and import require EDITOR or ADMIN (WRITE) in this workspace.",
          nextSteps: [
            "Ask a workspace administrator to grant WRITE or perform the operation.",
          ],
          severity: "error",
          recoverable: true,
        };
      }
      if (status === 404) {
        return {
          title: "Connector not found",
          explanation:
            "The connector or ConnectorVersion is not visible in this workspace.",
          nextSteps: ["Refresh the connector list and confirm the version id."],
          severity: "error",
          recoverable: true,
        };
      }
      return undefined;
    case "model_connectivity":
      if (status === 400) {
        return {
          title: "Invalid connectivity test",
          explanation:
            "The control plane rejected the connectivity test request.",
          nextSteps: [
            "Provide a model identifier that matches a ModelProfileVersion bound to this connection.",
          ],
          severity: "error",
          recoverable: true,
        };
      }
      return undefined;
    default:
      if (status === 401) {
        return {
          title: "Authentication required",
          explanation: "The Console session is missing or expired.",
          nextSteps: ["Sign in again through the Console login page."],
          severity: "error",
          recoverable: true,
        };
      }
      if (status === 403) {
        return {
          title: "Permission denied",
          explanation:
            "This human session is not authorized for the requested action in the selected workspace.",
          nextSteps: [
            "Confirm workspace membership and role with a workspace administrator.",
          ],
          severity: "error",
          recoverable: true,
        };
      }
      if (status === 404) {
        return {
          title: "Not found",
          explanation:
            "The requested resource is not visible in the authenticated workspace.",
          nextSteps: ["Verify the resource id and selected workspace."],
          severity: "error",
          recoverable: true,
        };
      }
      return undefined;
  }
}

export function describeConsoleApiError(
  error: unknown,
  context:
    | "create_run"
    | "generic"
    | "connector_discover"
    | "connector_import"
    | "model_connectivity" = "generic",
): OperatorGuidance | undefined {
  if (!(error instanceof ConsoleApiError)) {
    return undefined;
  }
  const byStatus = describeHttpStatusGuidance(error.status, context);
  if (byStatus !== undefined) {
    return byStatus;
  }
  if (error.body.code === "control_plane_unreachable") {
    return {
      title: "Control plane unreachable",
      explanation:
        "The Console BFF could not reach OSVA_BASE_URL. No upstream lifecycle data is available.",
      nextSteps: [
        "Verify apps/web is running and OSVA_BASE_URL matches the operator deployment.",
        "Check network policy between the Console server and the control plane.",
      ],
      severity: "error",
      recoverable: true,
    };
  }
  return undefined;
}

export function describeRunLifecycleGuidance(input: {
  readonly runStatus: string;
  readonly attemptStatus?: string;
  readonly execution?: RunAttemptExecutionDiagnostics;
}): OperatorGuidance | undefined {
  const { runStatus, attemptStatus, execution } = input;

  if (runStatus === "QUEUED" || attemptStatus === "PENDING") {
    return {
      title: "Queued for execution",
      explanation:
        "The Run is waiting to be picked up by an execution worker. Queue state is transport-only; durable status lives on the RunAttempt in PostgreSQL.",
      nextSteps: [
        "Confirm apps/worker is running and logs show queue consumption (consuming: true).",
        "Confirm Valkey is healthy and GET /ready on the control plane returns 200.",
        "The Console cannot determine worker health from QUEUED status alone.",
      ],
      severity: "info",
      recoverable: true,
    };
  }

  if (runStatus === "RUNNING" || attemptStatus === "RUNNING") {
    if (execution?.state === "running_lease_expired") {
      return {
        title: "Lease expired while running",
        explanation:
          "PostgreSQL shows a RUNNING attempt whose execution lease has expired. Recovery may mark this attempt FAILED with EXECUTION_INTERRUPTED.",
        nextSteps: [
          "Refresh Run Detail to read persisted attempt status after recovery runs.",
          "An expired lease is not proof a worker is offline.",
          "See OSVA execution recovery documentation for lease and recovery semantics.",
        ],
        severity: "warning",
        recoverable: false,
      };
    }
    if (execution?.state === "running_unleased") {
      return {
        title: "Running without a lease",
        explanation:
          "This attempt is RUNNING but has no execution lease columns populated (legacy or transitional state).",
        nextSteps: [
          "Treat completion as authoritative only when the attempt reaches a terminal status.",
          "Operators may need manual settlement for legacy unleased RUNNING rows.",
        ],
        severity: "warning",
      };
    }
    return {
      title: "Execution in progress",
      explanation:
        "A worker may be executing this RunAttempt. Active lease timestamps are persisted PostgreSQL state, not a worker heartbeat.",
      nextSteps: [
        "Keep polling Run Detail while status is RUNNING.",
        "Inspect RunSteps and usage as they appear.",
      ],
      severity: "info",
      recoverable: true,
    };
  }

  if (runStatus === "SUCCEEDED" || attemptStatus === "SUCCEEDED") {
    return undefined;
  }

  if (runStatus === "CANCELLED" || attemptStatus === "CANCELLED") {
    return {
      title: "Cancelled",
      explanation: "This Run or RunAttempt reached a terminal cancelled state.",
      nextSteps: [
        "Launch a new Run if work should continue. OSVA does not automatically retry cancelled attempts.",
      ],
      severity: "info",
      recoverable: true,
    };
  }

  return undefined;
}

export function describeRunAttemptFailureGuidance(input: {
  readonly error?: { readonly code?: string; readonly message?: string };
  readonly execution?: RunAttemptExecutionDiagnostics;
}): OperatorGuidance | undefined {
  const code = input.error?.code?.trim() ?? "";
  const execution = input.execution;

  if (code === "EXECUTION_INTERRUPTED" || execution?.interrupted === true) {
    return {
      title: "Execution interrupted",
      explanation:
        "This RunAttempt failed because execution ownership was lost (for example lease expiry). OSVA does not automatically re-execute the same attempt.",
      nextSteps: [
        "Inspect recoveryReason and execution diagnostics above.",
        "Start a new Run for a new logical attempt if work should be retried.",
        "See OSVA execution recovery documentation.",
      ],
      severity: "error",
      recoverable: true,
    };
  }

  if (code === "UNSUPPORTED_RUNTIME") {
    return {
      title: "Unsupported runtime on worker",
      explanation:
        "The worker has no adapter registered for this AgentVersion runtime type.",
      nextSteps: [
        "For TRUSTED_TYPESCRIPT, install entrypoint bytes under OSVA_TRUSTED_RUNTIME_ROOT with matching sha256 integrity.",
        "BUILTIN_PACKAGE is for test adapters; production workers typically fail with this code.",
        "Restart workers after changing trusted runtime files.",
      ],
      severity: "error",
      recoverable: true,
    };
  }

  if (code === "TOOL_NOT_AUTHORIZED") {
    return {
      title: "Tool not authorized",
      explanation:
        "ToolGateway denied the invocation for this AgentVersion binding or policy.",
      nextSteps: [
        "Verify toolVersionBindings on the immutable AgentVersion.",
        "Confirm connector tools were imported and bound with the expected binding name.",
        "Prompt text cannot grant tool permissions.",
      ],
      severity: "error",
      recoverable: true,
    };
  }

  if (code.startsWith("MCP_") || code.includes("CONNECTOR")) {
    return {
      title: "Connector or MCP failure",
      explanation:
        "Tool execution failed while calling an MCP connector. The sanitized error above is authoritative.",
      nextSteps: [
        "Verify ConnectorVersion endpoint URL, transport, and secret reference keys on the worker.",
        "Use connector discovery from the Console to confirm remote tools are reachable.",
        "Secret values are never shown in Console diagnostics.",
      ],
      severity: "error",
      recoverable: true,
    };
  }

  if (input.error !== undefined && code.length > 0) {
    return {
      title: "RunAttempt failed",
      explanation:
        "The worker persisted a terminal failure for this attempt. The sanitized error payload is shown below.",
      nextSteps: [
        "Inspect RunSteps for model or tool failures leading to this outcome.",
        "Fix configuration and start a new Run; automatic retry of the same attempt is not offered in Console.",
      ],
      severity: "error",
      recoverable: true,
    };
  }

  return undefined;
}

export function describeConnectorDiscoveryGuidance(input: {
  readonly transport?: string;
  readonly toolCount?: number;
}): OperatorGuidance | undefined {
  if (input.transport === "STDIO") {
    return {
      title: "STDIO connector",
      explanation:
        "STDIO ConnectorVersions are read-only in Console. Discovery may still call the configured process when permitted by the control plane.",
      nextSteps: [
        "New STDIO configurations are provisioned operator-side, not through the Streamable HTTP form.",
      ],
      severity: "info",
    };
  }
  if (input.toolCount === 0) {
    return {
      title: "No tools reported",
      explanation:
        "Discovery succeeded but the MCP server returned zero tools.",
      nextSteps: [
        "Confirm the MCP server exposes tools at the configured endpoint.",
        "Verify authentication secret reference keys resolve on the worker.",
      ],
      severity: "warning",
      recoverable: true,
    };
  }
  return undefined;
}

export function describeModelConnectivityResult(input: {
  readonly status: "READY" | "FAILED";
  readonly code?: string;
}): OperatorGuidance {
  if (input.status === "READY") {
    return {
      title: "Connectivity verified",
      explanation:
        "The control plane completed a one-shot generateText probe with the supplied model identifier.",
      nextSteps: [
        "Use the same model id on ModelProfileVersion bindings for this connection.",
      ],
      severity: "info",
      recoverable: true,
    };
  }

  const code = input.code?.trim() ?? "";
  if (code === "MODEL_PROVIDER_UNAUTHORIZED" || code.includes("UNAUTHORIZED")) {
    return {
      title: "Provider rejected credentials",
      explanation:
        "The provider endpoint responded as unauthorized. Credential values are not displayed.",
      nextSteps: [
        "Rotate the secret backing the connection version credential reference on the worker.",
        "Append a new connection version with an updated secret reference key if needed.",
      ],
      severity: "error",
      recoverable: true,
    };
  }
  if (code.includes("TIMEOUT") || code === "MODEL_PROVIDER_TIMEOUT") {
    return {
      title: "Provider timeout",
      explanation:
        "The connectivity probe timed out waiting for the provider endpoint.",
      nextSteps: [
        "Confirm base URL reachability from the control plane network.",
        "Retry when the provider is healthy; do not infer root cause from a single timeout.",
      ],
      severity: "warning",
      recoverable: true,
    };
  }
  if (code.includes("RATE") || code === "MODEL_PROVIDER_RATE_LIMITED") {
    return {
      title: "Provider rate limited",
      explanation: "The provider rejected the probe due to rate limiting.",
      nextSteps: [
        "Wait and retry the connectivity test.",
        "Reduce parallel model calls.",
      ],
      severity: "warning",
      recoverable: true,
    };
  }
  if (code.includes("PRIC") || code === "MODEL_PRICING_NOT_CONFIGURED") {
    return {
      title: "Pricing metadata missing",
      explanation:
        "Connectivity may still succeed while usage cost remains unpriced for this model.",
      nextSteps: [
        "Configure pricing on the ModelProfileVersion or provider catalog as required for cost gates.",
        "Evaluation quality gates may report INDETERMINATE when usage is unpriced.",
      ],
      severity: "warning",
      recoverable: true,
    };
  }

  return {
    title: "Connectivity test failed",
    explanation:
      "The control plane reported FAILED for the connectivity probe. The code field is authoritative when present.",
    nextSteps: [
      "Verify endpoint base URL, model identifier, and credential reference configuration.",
      "Inspect RunSteps on failing agent Runs for runtime model errors.",
    ],
    severity: "error",
    recoverable: true,
  };
}

export function describeWorkflowRunGuidance(input: {
  readonly status: string;
  readonly error?: { readonly code?: string; readonly message?: string };
}): OperatorGuidance | undefined {
  if (input.status === "WAITING") {
    return {
      title: "Workflow suspended",
      explanation:
        "The WorkflowRun is waiting for approval or an external event. Workers are not kept alive during waits.",
      nextSteps: [
        "Use the Waiting section and node execution cards to approve or emit events.",
        "Graph overlay reflects persisted WorkflowNodeRun status only.",
      ],
      severity: "info",
      recoverable: true,
    };
  }

  if (input.status === "FAILED") {
    return {
      title: "Workflow failed",
      explanation:
        "The WorkflowRun reached a terminal failed state. Child AGENT Runs may have separate failure details.",
      nextSteps: [
        "Inspect failed WorkflowNodeRuns on the graph and open linked child Runs.",
        "Console does not offer unsupported workflow replay or cancellation recovery actions.",
      ],
      severity: "error",
      recoverable: true,
    };
  }

  if (input.status === "RUNNING") {
    return {
      title: "Workflow executing",
      explanation:
        "Orchestration is in progress. Node overlay shows latest persisted WorkflowNodeRun per key.",
      nextSteps: ["Refresh while status is RUNNING or WAITING."],
      severity: "info",
      recoverable: true,
    };
  }

  return undefined;
}

export function describeKnowledgeIndexFailureGuidance(input: {
  readonly status: string;
  readonly lastErrorCode?: string;
  readonly lastErrorMessage?: string;
}): OperatorGuidance | undefined {
  if (input.status !== "FAILED") {
    return undefined;
  }
  return {
    title: "Knowledge index failed",
    explanation:
      "Ingestion did not reach READY. The knowledge worker persists lastErrorCode and lastErrorMessage on the index.",
    nextSteps: [
      "Confirm knowledge-worker, embedding provider, and vector store configuration.",
      "Use Retry indexing when WRITE is available; ingestion runs asynchronously.",
    ],
    severity: "error",
    recoverable: true,
  };
}

/** @deprecated Prefer describeHttpStatusGuidance with context create_run */
export function describeCreateRunFailure(status: number): string | undefined {
  const guidance = describeHttpStatusGuidance(status, "create_run");
  if (guidance === undefined) {
    return undefined;
  }
  return `${guidance.explanation} ${guidance.nextSteps[0] ?? ""}`.trim();
}
