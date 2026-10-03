import type {
  RunAttemptId,
  RunId,
  ToolVersionId,
  ToolVersionResourceV1,
  WorkflowRunResourceV1,
} from "@osva-ai/contracts";

import type { OperatorApi } from "../scripts/lib/operator-client.js";
import {
  deriveDeliveryWaitPresentation,
  extractWorkflowRequestFields,
  indexDefinitionNodesByKey,
  type DeliveryWaitPresentation,
} from "../scripts/lib/workflow-definition.js";
import {
  buildWorkflowStatusView,
  CANONICAL_NODE_ORDER,
  type AnalysisDetails,
  type ApprovalDetails,
  type CanonicalNodeKey,
  type ReportOutcomeDetails,
} from "../scripts/lib/workflow-status.js";
import {
  fetchToolVersion,
  listAllRunSteps,
  sortRunSteps,
  stepDurationMs,
  type RunStepResource,
} from "./run-observability.js";

export const DEMO_NODE_LABELS: Record<CanonicalNodeKey, string> = {
  research: "Research",
  analysis: "Analysis",
  "adoption-approval": "Approval",
  "delivery-wait": "Delivery Wait",
  report: "Report",
};

export interface DemoRunStepView {
  readonly id: string;
  readonly kind: RunStepResource["kind"];
  readonly bindingName: string;
  readonly status: RunStepResource["status"];
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly modelProfileVersionId?: string;
  readonly toolVersionId?: string;
  readonly toolType?: ToolVersionResourceV1["type"];
  readonly toolMcpBacked?: boolean;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly estimatedCostUsdMicros?: number | null;
  readonly errorCode?: string;
}

export interface DemoRunAttemptView {
  readonly id: RunAttemptId;
  readonly sequence: number;
  readonly status: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly error?: { readonly code: string; readonly message: string };
  readonly output?: unknown;
}

export interface DemoChildRunView {
  readonly runId: RunId;
  readonly runStatus: string;
  readonly agentId?: string;
  readonly agentVersionId?: string;
  readonly attempts: readonly DemoRunAttemptView[];
  readonly latestAttempt?: DemoRunAttemptView;
  readonly steps: readonly DemoRunStepView[];
}

export interface DemoCanonicalNodeView {
  readonly key: CanonicalNodeKey;
  readonly label: string;
  readonly nodeType: string;
  readonly persistedStatus?: string;
  readonly presentationStatus: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly error?: { readonly code: string; readonly message: string };
  readonly childRun?: DemoChildRunView;
  readonly approval?: ApprovalDetails & { readonly decidedAt?: string };
  readonly deliveryWait?: DeliveryWaitPresentation;
  readonly analysis?: AnalysisDetails;
}

export interface DemoArtifactSummary {
  readonly artifactId: string;
  readonly name?: string;
  readonly mediaType?: string;
  readonly sizeBytes?: number;
  readonly digest?: string;
  readonly producer?: {
    readonly runId: string;
    readonly runAttemptId: string;
  };
}

export interface CanonicalDemoReadModel {
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly workflowVersionId: string;
  readonly workflowStatus: WorkflowRunResourceV1["status"];
  readonly requestId?: string;
  readonly packageName?: string;
  readonly useCase?: string;
  readonly constraints?: readonly string[];
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly workflowError?: { readonly code: string; readonly message: string };
  readonly nodes: readonly DemoCanonicalNodeView[];
  readonly artifact?: DemoArtifactSummary;
}

export interface CanonicalDemoReadModelOptions {
  readonly toolVersionIdToToolId?: ReadonlyMap<string, string>;
}

function latestAttempt<T extends { sequence: number }>(
  attempts: readonly T[],
): T | undefined {
  if (attempts.length === 0) {
    return undefined;
  }
  return [...attempts].sort((left, right) => right.sequence - left.sequence)[0];
}

async function enrichRunStep(
  api: OperatorApi,
  step: RunStepResource,
  toolVersionIdToToolId: ReadonlyMap<string, string> | undefined,
): Promise<DemoRunStepView> {
  let toolType: ToolVersionResourceV1["type"] | undefined;
  let toolMcpBacked: boolean | undefined;

  if (step.toolVersionId !== undefined && toolVersionIdToToolId !== undefined) {
    const toolId = toolVersionIdToToolId.get(step.toolVersionId);
    if (toolId !== undefined) {
      const version = await fetchToolVersion(
        api.http,
        toolId,
        step.toolVersionId as ToolVersionId,
      );
      if (version !== undefined) {
        toolType = version.type;
        toolMcpBacked = version.type === "MCP";
      }
    }
  }

  return {
    id: step.id,
    kind: step.kind,
    bindingName: step.bindingName,
    status: step.status,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    durationMs: stepDurationMs(step),
    modelProfileVersionId: step.modelProfileVersionId,
    toolVersionId: step.toolVersionId,
    toolType,
    toolMcpBacked,
    inputTokens: step.inputTokens,
    outputTokens: step.outputTokens,
    totalTokens: step.totalTokens,
    estimatedCostUsdMicros: step.estimatedCostUsdMicros,
    errorCode: step.errorCode,
  };
}

async function buildChildRunView(
  api: OperatorApi,
  runId: RunId,
  toolVersionIdToToolId: ReadonlyMap<string, string> | undefined,
): Promise<DemoChildRunView | undefined> {
  let run;
  try {
    run = await api.sdk.runs.get(runId);
  } catch {
    return undefined;
  }

  let attempts: DemoRunAttemptView[] = [];
  try {
    const listed = await api.sdk.runs.listAttempts(runId);
    attempts = listed.attempts.map((attempt) => ({
      id: attempt.id,
      sequence: attempt.sequence,
      status: attempt.status,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      error: attempt.error,
      output: attempt.output,
    }));
  } catch {
    // Attempt list optional for partial failures.
  }

  const latest = latestAttempt(attempts);
  let steps: DemoRunStepView[] = [];
  if (latest !== undefined) {
    try {
      const rawSteps = sortRunSteps(
        await listAllRunSteps(api.http, runId, latest.id),
      );
      steps = await Promise.all(
        rawSteps.map((step) => enrichRunStep(api, step, toolVersionIdToToolId)),
      );
    } catch {
      // Step aggregation is optional enrichment.
    }
  }

  return {
    runId,
    runStatus: run.status,
    agentId: run.agentId,
    agentVersionId: run.effectiveBindings.agentVersionId,
    attempts,
    latestAttempt: latest,
    steps,
  };
}

function artifactFromReportOutcome(
  reportOutcome: ReportOutcomeDetails | undefined,
  producer?: DemoArtifactSummary["producer"],
): DemoArtifactSummary | undefined {
  if (reportOutcome === undefined) {
    return undefined;
  }
  return {
    artifactId: reportOutcome.artifactId,
    name: reportOutcome.artifactName,
    mediaType: reportOutcome.artifactMediaType,
    sizeBytes: reportOutcome.artifactSizeBytes,
    digest: reportOutcome.artifactDigest,
    producer,
  };
}

export async function buildCanonicalDemoReadModel(
  api: OperatorApi,
  run: WorkflowRunResourceV1,
  workflowDefinition: unknown,
  options: CanonicalDemoReadModelOptions = {},
): Promise<CanonicalDemoReadModel> {
  const approvalTitles = indexDefinitionNodesByKey(workflowDefinition);
  const titleByKey = new Map<string, string>();
  for (const [key, node] of approvalTitles) {
    if (node.title !== undefined) {
      titleByKey.set(key, node.title);
    }
  }

  const statusView = await buildWorkflowStatusView(api, run, titleByKey);
  const requestFields = extractWorkflowRequestFields(run.input);
  const definitionByKey = indexDefinitionNodesByKey(workflowDefinition);

  const nodes: DemoCanonicalNodeView[] = [];

  for (const spec of CANONICAL_NODE_ORDER) {
    const nodeRun = statusView.nodeRunsByKey.get(spec.key);
    const defNode = definitionByKey.get(spec.key);
    const presentationStatus =
      nodeRun?.status === undefined ? "NOT_STARTED" : nodeRun.status;

    let childRun: DemoChildRunView | undefined;
    if (
      spec.key === "research" ||
      spec.key === "analysis" ||
      spec.key === "report"
    ) {
      const childRunId = nodeRun?.childRunId as RunId | undefined;
      if (childRunId !== undefined) {
        childRun = await buildChildRunView(
          api,
          childRunId,
          options.toolVersionIdToToolId,
        );
      }
    }

    let approval: DemoCanonicalNodeView["approval"];
    if (spec.key === "adoption-approval" && statusView.approval !== undefined) {
      const approvalResource = run.approvalRequests.find(
        (item) => item.id === statusView.approval?.id,
      );
      approval = {
        ...statusView.approval,
        decidedAt: approvalResource?.decidedAt,
      };
    }

    let deliveryWait: DeliveryWaitPresentation | undefined;
    if (spec.key === "delivery-wait") {
      deliveryWait = deriveDeliveryWaitPresentation(defNode?.wait, run.input);
    }

    nodes.push({
      key: spec.key,
      label: DEMO_NODE_LABELS[spec.key],
      nodeType: defNode?.type ?? "UNKNOWN",
      persistedStatus: nodeRun?.status,
      presentationStatus,
      startedAt: nodeRun?.startedAt,
      completedAt: nodeRun?.completedAt,
      error: nodeRun?.error,
      childRun,
      analysis: spec.key === "analysis" ? statusView.analysis : undefined,
      approval,
      deliveryWait,
    });
  }

  let artifact: DemoArtifactSummary | undefined;
  if (statusView.reportOutcome !== undefined) {
    let producer: DemoArtifactSummary["producer"];
    try {
      const artifactResource = await api.sdk.artifacts.get(
        statusView.reportOutcome.artifactId as never,
      );
      if (artifactResource.producer !== undefined) {
        producer = {
          runId: artifactResource.producer.runId,
          runAttemptId: artifactResource.producer.runAttemptId,
        };
      }
      artifact = {
        artifactId: statusView.reportOutcome.artifactId,
        name: artifactResource.name,
        mediaType: artifactResource.mediaType,
        sizeBytes: artifactResource.sizeBytes,
        digest: artifactResource.digest,
        producer,
      };
    } catch {
      artifact = artifactFromReportOutcome(statusView.reportOutcome, producer);
    }
  }

  return {
    workflowRunId: run.id,
    workflowId: run.workflowId,
    workflowVersionId: run.workflowVersionId,
    workflowStatus: run.status,
    requestId: statusView.requestId ?? requestFields.requestId,
    packageName: requestFields.packageName,
    useCase: requestFields.useCase,
    constraints: requestFields.constraints,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    workflowError: run.error,
    nodes,
    artifact,
  };
}
