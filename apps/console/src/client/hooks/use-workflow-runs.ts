import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { consoleFetch } from "../lib/console-api";
import { ACTIVE_RUN_POLL_MS } from "../lib/query-client";
import { isWorkflowRunLive } from "../lib/statuses";

export interface WorkflowRunSummaryResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly workflowId: string;
  readonly workflowVersionId: string;
  readonly status: string;
  readonly error?: { readonly code: string; readonly message: string };
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowRunListResource {
  readonly workflowRuns: readonly WorkflowRunSummaryResource[];
  readonly nextCursor?: string;
}

export interface WorkflowNodeRunResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly workflowRunId: string;
  readonly workflowNodeKey: string;
  readonly sequence: number;
  readonly status: string;
  readonly input: unknown;
  readonly output?: unknown;
  readonly childRunId?: string;
  readonly selectedTargetKey?: string;
  readonly error?: { readonly code: string; readonly message: string };
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApprovalRequestResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly workflowRunId: string;
  readonly workflowNodeRunId: string;
  readonly status: string;
  readonly decisionComment?: string;
  readonly decidedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowRunResource extends WorkflowRunSummaryResource {
  readonly input: unknown;
  readonly output?: unknown;
  readonly nodeRuns: readonly WorkflowNodeRunResource[];
  readonly approvalRequests: readonly ApprovalRequestResource[];
}

export interface ListWorkflowRunsFilters {
  readonly status?: string;
  readonly workflowId?: string;
  readonly workflowVersionId?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface IngestWorkflowEventInput {
  readonly source: string;
  readonly eventType: string;
  readonly correlationKey: string;
  readonly idempotencyKey: string;
  readonly payload: unknown;
  readonly occurredAt?: string;
}

function buildWorkflowRunsPath(filters: ListWorkflowRunsFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.workflowId) params.set("workflowId", filters.workflowId);
  if (filters.workflowVersionId)
    params.set("workflowVersionId", filters.workflowVersionId);
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  const queryString = params.toString();
  return queryString.length > 0
    ? `/api/v1/workflow-runs?${queryString}`
    : "/api/v1/workflow-runs";
}

export function useWorkflowRunsListQuery(filters: ListWorkflowRunsFilters) {
  const path = buildWorkflowRunsPath(filters);
  return useQuery({
    queryKey: ["workflow-runs", "list", filters],
    queryFn: () => consoleFetch<WorkflowRunListResource>(path),
  });
}

export function useWorkflowRunQuery(workflowRunId: string | undefined) {
  return useQuery({
    queryKey: ["workflow-runs", workflowRunId],
    enabled: workflowRunId !== undefined,
    queryFn: () =>
      consoleFetch<WorkflowRunResource>(
        `/api/v1/workflow-runs/${workflowRunId}`,
      ),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status !== undefined && isWorkflowRunLive(status)
        ? ACTIVE_RUN_POLL_MS
        : false;
    },
  });
}

export function useApprovalDecisionMutation(workflowRunId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly approvalRequestId: string;
      readonly decision: "APPROVED" | "REJECTED";
      readonly comment?: string;
    }) =>
      consoleFetch<ApprovalRequestResource>(
        `/api/v1/approval-requests/${encodeURIComponent(input.approvalRequestId)}/decision`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            decision: input.decision,
            ...(input.comment !== undefined && input.comment.length > 0
              ? { comment: input.comment }
              : {}),
          }),
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["workflow-runs", workflowRunId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["workflow-runs", "list"],
      });
    },
  });
}

export function useIngestWorkflowEventMutation(workflowRunId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: IngestWorkflowEventInput) =>
      consoleFetch<unknown>("/api/v1/workflow-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["workflow-runs", workflowRunId],
      });
    },
  });
}
