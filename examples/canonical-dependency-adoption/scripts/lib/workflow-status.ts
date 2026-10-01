import type {
  ApprovalRequestId,
  ApprovalRequestResourceV1,
  ArtifactId,
  RunId,
  WorkflowNodeRunId,
  WorkflowNodeRunResourceV1,
  WorkflowRunId,
  WorkflowRunResourceV1,
} from "@osva-ai/contracts";

import type { OperatorApi } from "./operator-client.js";

type WorkflowRunResource = WorkflowRunResourceV1;
type WorkflowNodeRunResource = WorkflowNodeRunResourceV1;
type ApprovalRequestResource = ApprovalRequestResourceV1;

export const CANONICAL_NODE_ORDER = [
  { key: "research", label: "Research" },
  { key: "analysis", label: "Analysis" },
  { key: "adoption-approval", label: "Approval" },
  { key: "delivery-wait", label: "Delivery Event" },
  { key: "report", label: "Report" },
] as const;

export type CanonicalNodeKey = (typeof CANONICAL_NODE_ORDER)[number]["key"];

const TERMINAL_WORKFLOW_STATUSES = new Set([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);

export function statusDisplaySymbol(
  status: WorkflowNodeRunResource["status"] | "NOT_STARTED",
): string {
  switch (status) {
    case "SUCCEEDED":
      return "✓";
    case "FAILED":
      return "✗";
    case "WAITING":
      return "◷";
    case "RUNNING":
      return "…";
    case "PENDING":
    case "NOT_STARTED":
      return "-";
    case "SKIPPED":
      return "-";
    case "CANCELLED":
      return "✗";
    default:
      return "-";
  }
}

export function formatNodeStatusText(
  status: WorkflowNodeRunResource["status"] | undefined,
): string {
  if (status === undefined) {
    return "PENDING";
  }
  return status;
}

export interface AgentNodeDetails {
  readonly runId: RunId;
  readonly attemptSummary: string;
}

export interface AnalysisDetails {
  readonly recommendation: string;
  readonly confidence: string;
  readonly summary: string;
}

export interface ApprovalDetails {
  readonly id: ApprovalRequestId;
  readonly status: ApprovalRequestResource["status"];
  readonly title: string | undefined;
  readonly comment: string | undefined;
}

export interface ReportOutcomeDetails {
  readonly disposition: string;
  readonly summary: string;
  readonly artifactId: string;
  readonly artifactName?: string;
  readonly artifactMediaType?: string;
  readonly artifactSizeBytes?: number;
  readonly artifactDigest?: string;
}

export interface WorkflowStatusView {
  readonly workflowRunId: WorkflowRunId;
  readonly workflowStatus: WorkflowRunResource["status"];
  readonly requestId: string | undefined;
  readonly nodeRunsByKey: Map<string, WorkflowNodeRunResource>;
  readonly agentDetails: Map<CanonicalNodeKey, AgentNodeDetails>;
  readonly analysis: AnalysisDetails | undefined;
  readonly approval: ApprovalDetails | undefined;
  readonly reportOutcome: ReportOutcomeDetails | undefined;
}

export function indexNodeRuns(
  run: WorkflowRunResource,
): Map<string, WorkflowNodeRunResource> {
  const map = new Map<string, WorkflowNodeRunResource>();
  for (const nodeRun of run.nodeRuns) {
    map.set(nodeRun.workflowNodeKey, nodeRun);
  }
  return map;
}

export function extractAnalysisDetails(
  output: unknown,
): AnalysisDetails | undefined {
  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    return undefined;
  }
  const analysis = (output as Record<string, unknown>).analysis;
  if (
    analysis === null ||
    typeof analysis !== "object" ||
    Array.isArray(analysis)
  ) {
    return undefined;
  }
  const record = analysis as Record<string, unknown>;
  const disposition = record.disposition;
  const confidence = record.confidence;
  const summary = record.summary;
  if (
    typeof disposition !== "string" ||
    typeof confidence !== "string" ||
    typeof summary !== "string"
  ) {
    return undefined;
  }
  return {
    recommendation: disposition,
    confidence,
    summary,
  };
}

export function extractReportOutcome(
  output: unknown,
):
  | Omit<
      ReportOutcomeDetails,
      | "artifactName"
      | "artifactMediaType"
      | "artifactSizeBytes"
      | "artifactDigest"
    >
  | undefined {
  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    return undefined;
  }
  const record = output as Record<string, unknown>;
  const disposition = record.disposition;
  const summary = record.summary;
  const artifact = record.artifact;
  if (typeof disposition !== "string" || typeof summary !== "string") {
    return undefined;
  }
  if (
    artifact === null ||
    typeof artifact !== "object" ||
    Array.isArray(artifact)
  ) {
    return undefined;
  }
  const artifactId = (artifact as Record<string, unknown>).artifactId;
  if (typeof artifactId !== "string" || artifactId.length === 0) {
    return undefined;
  }
  return {
    disposition,
    summary,
    artifactId,
  };
}

export function extractRequestIdFromRunInput(
  input: unknown,
): string | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const request = (input as Record<string, unknown>).request;
  if (
    request === null ||
    typeof request !== "object" ||
    Array.isArray(request)
  ) {
    return undefined;
  }
  const requestId = (request as Record<string, unknown>).requestId;
  return typeof requestId === "string" && requestId.length > 0
    ? requestId
    : undefined;
}

export function findApprovalForNode(
  run: WorkflowRunResource,
  workflowNodeRunId: WorkflowNodeRunId | undefined,
): ApprovalRequestResource | undefined {
  if (workflowNodeRunId === undefined) {
    return undefined;
  }
  return run.approvalRequests.find(
    (approval) => approval.workflowNodeRunId === workflowNodeRunId,
  );
}

export function findPendingApprovalsForRun(
  run: WorkflowRunResource,
): readonly ApprovalRequestResource[] {
  return run.approvalRequests.filter(
    (approval) =>
      approval.workflowRunId === run.id && approval.status === "PENDING",
  );
}

export function assertWorkflowAllowsApprovalDecision(
  run: WorkflowRunResource,
): void {
  if (TERMINAL_WORKFLOW_STATUSES.has(run.status)) {
    throw new ApprovalCommandError(
      `Workflow run ${run.id} is terminal (${run.status}). Approval cannot be decided.`,
    );
  }
}

export function selectPendingApprovalForDecision(
  run: WorkflowRunResource,
): ApprovalRequestResource {
  assertWorkflowAllowsApprovalDecision(run);
  const pending = findPendingApprovalsForRun(run);
  if (pending.length === 0) {
    throw new ApprovalCommandError(
      "No pending approval request exists for this workflow run yet.",
    );
  }
  if (pending.length > 1) {
    throw new ApprovalCommandError(
      "Multiple pending approval requests match this workflow run. Resolve ambiguity before deciding.",
    );
  }
  return pending[0]!;
}

export class ApprovalCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalCommandError";
  }
}

export async function summarizeRunAttempts(
  api: OperatorApi,
  runId: RunId,
): Promise<string> {
  const listed = await api.sdk.runs.listAttempts(runId);
  const attempts = listed.attempts;
  if (attempts.length === 0) {
    return "0";
  }
  const latest = [...attempts].sort(
    (left, right) => right.sequence - left.sequence,
  )[0];
  if (latest === undefined) {
    return String(attempts.length);
  }
  return `${attempts.length} (latest ${latest.status})`;
}

async function resolveAgentOutput(
  api: OperatorApi,
  nodeRun: WorkflowNodeRunResource,
): Promise<unknown> {
  if (nodeRun.output !== undefined) {
    return nodeRun.output;
  }
  const childRunId = nodeRun.childRunId;
  if (childRunId === undefined) {
    return undefined;
  }
  const listed = await api.sdk.runs.listAttempts(childRunId as RunId);
  const succeeded = [...listed.attempts]
    .reverse()
    .find(
      (attempt) =>
        attempt.status === "SUCCEEDED" && attempt.output !== undefined,
    );
  return succeeded?.output;
}

export async function buildWorkflowStatusView(
  api: OperatorApi,
  run: WorkflowRunResource,
  approvalTitleByNodeKey: ReadonlyMap<string, string>,
): Promise<WorkflowStatusView> {
  const nodeRunsByKey = indexNodeRuns(run);
  const agentDetails = new Map<CanonicalNodeKey, AgentNodeDetails>();
  let analysis: AnalysisDetails | undefined;

  for (const spec of CANONICAL_NODE_ORDER) {
    if (
      spec.key !== "research" &&
      spec.key !== "analysis" &&
      spec.key !== "report"
    ) {
      continue;
    }
    const nodeRun = nodeRunsByKey.get(spec.key);
    if (nodeRun?.childRunId === undefined) {
      continue;
    }
    agentDetails.set(spec.key, {
      runId: nodeRun.childRunId as RunId,
      attemptSummary: await summarizeRunAttempts(
        api,
        nodeRun.childRunId as RunId,
      ),
    });
  }

  const analysisNode = nodeRunsByKey.get("analysis");
  if (analysisNode !== undefined && analysisNode.status === "SUCCEEDED") {
    const output = await resolveAgentOutput(api, analysisNode);
    analysis = extractAnalysisDetails(output);
  }

  const approvalNode = nodeRunsByKey.get("adoption-approval");
  const approvalResource = findApprovalForNode(run, approvalNode?.id);
  const approval =
    approvalResource === undefined
      ? undefined
      : {
          id: approvalResource.id,
          status: approvalResource.status,
          title: approvalTitleByNodeKey.get("adoption-approval"),
          comment: approvalResource.decisionComment,
        };

  let reportOutcome: ReportOutcomeDetails | undefined;
  if (run.status === "SUCCEEDED" && run.output !== undefined) {
    const base = extractReportOutcome(run.output);
    if (base !== undefined) {
      reportOutcome = { ...base };
      try {
        const artifact = await api.sdk.artifacts.get(
          base.artifactId as ArtifactId,
        );
        reportOutcome = {
          ...reportOutcome,
          artifactName: artifact.name,
          artifactMediaType: artifact.mediaType,
          artifactSizeBytes: artifact.sizeBytes,
          artifactDigest: artifact.digest,
        };
      } catch {
        // Artifact metadata is optional enrichment.
      }
    }
  }

  return {
    workflowRunId: run.id,
    workflowStatus: run.status,
    requestId: extractRequestIdFromRunInput(run.input),
    nodeRunsByKey,
    agentDetails,
    analysis,
    approval,
    reportOutcome,
  };
}

export function renderWorkflowStatusLines(view: WorkflowStatusView): string[] {
  const lines: string[] = [];
  lines.push("Dependency Adoption Review");
  lines.push("");
  lines.push(`Workflow Run: ${view.workflowRunId}`);
  lines.push(`Status: ${view.workflowStatus}`);
  lines.push("");

  for (const spec of CANONICAL_NODE_ORDER) {
    const nodeRun = view.nodeRunsByKey.get(spec.key);
    const statusText = formatNodeStatusText(nodeRun?.status);
    const symbol = statusDisplaySymbol(nodeRun?.status ?? "NOT_STARTED");
    const label = spec.label.padEnd(18, " ");
    lines.push(`${label}${symbol} ${statusText}`);

    if (
      nodeRun !== undefined &&
      (spec.key === "research" ||
        spec.key === "analysis" ||
        spec.key === "report")
    ) {
      const agent = view.agentDetails.get(spec.key);
      if (agent !== undefined) {
        lines.push(`  Run: ${agent.runId}`);
        lines.push(`  Attempt(s): ${agent.attemptSummary}`);
      }
    }
  }

  if (view.analysis !== undefined) {
    lines.push("");
    lines.push(`Recommendation: ${view.analysis.recommendation}`);
    lines.push(`Confidence: ${view.analysis.confidence}`);
    lines.push(`Summary: ${view.analysis.summary}`);
  }

  if (view.approval !== undefined) {
    lines.push("");
    lines.push("Approval:");
    if (view.approval.status === "PENDING") {
      lines.push(`  ID:       ${view.approval.id}`);
      lines.push(`  Status:   ${view.approval.status}`);
      if (view.approval.title !== undefined) {
        lines.push(`  Title:    ${view.approval.title}`);
      }
    } else {
      lines.push(`  Status:   ${view.approval.status}`);
      if (view.approval.comment !== undefined) {
        lines.push(`  Comment:  ${view.approval.comment}`);
      }
    }
  }

  if (view.workflowStatus === "SUCCEEDED") {
    lines.push("");
    lines.push("Workflow: SUCCEEDED");
    if (view.reportOutcome !== undefined) {
      lines.push(`Disposition: ${view.reportOutcome.disposition}`);
      lines.push(`Summary:     ${view.reportOutcome.summary}`);
      lines.push("");
      lines.push("Artifact:");
      lines.push(`  ID: ${view.reportOutcome.artifactId}`);
      if (view.reportOutcome.artifactName !== undefined) {
        lines.push(`  Name: ${view.reportOutcome.artifactName}`);
      }
      if (view.reportOutcome.artifactMediaType !== undefined) {
        lines.push(`  Media type: ${view.reportOutcome.artifactMediaType}`);
      }
      if (view.reportOutcome.artifactSizeBytes !== undefined) {
        lines.push(`  Size: ${view.reportOutcome.artifactSizeBytes} bytes`);
      }
      if (view.reportOutcome.artifactDigest !== undefined) {
        lines.push(`  SHA-256: ${view.reportOutcome.artifactDigest}`);
      }
    }
  }

  return lines;
}
