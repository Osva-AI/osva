import { createHash } from "node:crypto";
import { text } from "node:stream/consumers";

import type {
  ApprovalRequestId,
  ArtifactId,
  RunAttemptId,
  RunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  PostgresApprovalRequestRepository,
  PostgresArtifactRepository,
  PostgresRunRepository,
  PostgresWorkflowRunRepository,
  PostgresWorkflowWaitRepository,
  type Database,
} from "@osva/db";

export interface LifecycleCounts {
  workflowRuns: number;
  workflowNodeRuns: number;
  childRuns: number;
  approvalRequests: number;
  workflowWaits: number;
  workflowEvents: number;
  reportArtifacts: number;
}

export async function loadLifecycleCounts(
  database: Database,
  workspaceId: WorkspaceId,
  workflowRunId: WorkflowRunId,
): Promise<LifecycleCounts> {
  const workflowRuns = new PostgresWorkflowRunRepository(database);
  const runs = new PostgresRunRepository(database);
  const approvals = new PostgresApprovalRequestRepository(database);
  const waits = new PostgresWorkflowWaitRepository(database);
  const artifacts = new PostgresArtifactRepository(database);

  const nodeRuns = await workflowRuns.listWorkflowNodeRuns(workflowRunId);
  const childRunIds = nodeRuns
    .map((node) => node.childRunId)
    .filter((id): id is RunId => id !== undefined && id !== null);

  const runsListed = await runs.listRuns({ workspaceId, limit: 100 });
  const childRuns = runsListed.runs.filter((run) =>
    childRunIds.includes(run.id),
  );

  const approvalList =
    await approvals.listApprovalRequestsByWorkflowRunId(workflowRunId);
  const waitList = await waits.listWorkflowWaitsByWorkflowRunId(workflowRunId);

  const eventCountRows = await database.sql<{ count: number }[]>`
    select count(*)::int as count from workflow_events where workspace_id = ${workspaceId}
  `;
  const reportArtifactRows = await database.sql<{ count: number }[]>`
    select count(*)::int as count from artifacts
    where workspace_id = ${workspaceId}
      and metadata->>'kind' = 'osva.canonical.dependency-adoption-review'
  `;

  return {
    workflowRuns: 1,
    workflowNodeRuns: nodeRuns.length,
    childRuns: childRuns.length,
    approvalRequests: approvalList.length,
    workflowWaits: waitList.length,
    workflowEvents: eventCountRows[0]?.count ?? 0,
    reportArtifacts: reportArtifactRows[0]?.count ?? 0,
  };
}

export async function assertArtifactBytesMatchDigest(
  database: Database,
  workspaceId: WorkspaceId,
  artifactId: ArtifactId,
  openContent: (
    artifactId: ArtifactId,
  ) => Promise<{ content: NodeJS.ReadableStream }>,
): Promise<{ readonly bytes: Buffer; readonly digest: string }> {
  const artifacts = new PostgresArtifactRepository(database);
  const artifact = await artifacts.findById(artifactId);
  if (artifact === null || artifact.workspaceId !== workspaceId) {
    throw new Error(`Artifact ${artifactId} was not found for workspace.`);
  }
  const opened = await openContent(artifactId);
  const bytes = Buffer.from(await text(opened.content));
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (digest !== artifact.digest) {
    throw new Error(
      `Artifact digest mismatch: expected ${artifact.digest}, computed ${digest}.`,
    );
  }
  return { bytes, digest: artifact.digest };
}

export function findApprovalForWorkflowRun(
  approvalRequests: ReadonlyArray<{
    readonly id: ApprovalRequestId;
    readonly status: string;
  }>,
): { readonly id: ApprovalRequestId; readonly status: string } {
  if (approvalRequests.length !== 1) {
    throw new Error(
      `Expected exactly one ApprovalRequest, found ${String(approvalRequests.length)}.`,
    );
  }
  return approvalRequests[0]!;
}

export async function assertResearchNpmToolsInvokedOnce(
  database: Database,
  researchRunId: RunId,
): Promise<void> {
  const rows = await database.sql<{ binding_name: string }[]>`
    select binding_name from run_steps
    where run_id = ${researchRunId}
      and kind = 'TOOL'
    order by started_at asc
  `;
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.binding_name, (counts.get(row.binding_name) ?? 0) + 1);
  }
  if (counts.get("npm_package_metadata") !== 1) {
    throw new Error(
      `Expected npm_package_metadata once, got ${String(counts.get("npm_package_metadata") ?? 0)}.`,
    );
  }
  if (counts.get("npm_downloads") !== 1) {
    throw new Error(
      `Expected npm_downloads once, got ${String(counts.get("npm_downloads") ?? 0)}.`,
    );
  }
}

export async function listRunAttemptsForRun(
  database: Database,
  runId: RunId,
): Promise<
  ReadonlyArray<{ readonly id: RunAttemptId; readonly sequence: number }>
> {
  const runs = new PostgresRunRepository(database);
  const attempts = await runs.listRunAttempts(runId);
  return attempts.map((attempt) => ({
    id: attempt.id,
    sequence: attempt.sequence,
  }));
}
