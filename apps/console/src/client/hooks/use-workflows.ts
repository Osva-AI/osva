import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { WorkflowDefinitionV3 } from "@osva-ai/contracts";

import { consoleFetch } from "../lib/console-api";
import type { WorkflowDefinitionView } from "../lib/workflow-definition";
import { useWorkspaceQueryScope } from "./use-workspace-query-scope";

export interface WorkflowResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowListResource {
  readonly workflows: readonly WorkflowResource[];
}

export interface WorkflowVersionResource {
  readonly id: string;
  readonly workflowId: string;
  readonly workspaceId: string;
  readonly version: number;
  readonly definition: WorkflowDefinitionView;
  readonly createdAt: string;
}

export interface WorkflowVersionListResource {
  readonly versions: readonly WorkflowVersionResource[];
}

export function useWorkflowsListQuery() {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["workflows", workspaceId, "list"],
    enabled: workspaceId !== undefined,
    queryFn: () => consoleFetch<WorkflowListResource>("/api/v1/workflows"),
  });
}

export function useWorkflowQuery(workflowId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["workflows", workspaceId, workflowId],
    enabled: workspaceId !== undefined && workflowId !== undefined,
    queryFn: () =>
      consoleFetch<WorkflowResource>(`/api/v1/workflows/${workflowId}`),
  });
}

export function useWorkflowVersionsQuery(workflowId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["workflows", workspaceId, workflowId, "versions"],
    enabled: workspaceId !== undefined && workflowId !== undefined,
    queryFn: () =>
      consoleFetch<WorkflowVersionListResource>(
        `/api/v1/workflows/${workflowId}/versions`,
      ),
  });
}

export function useWorkflowVersionQuery(
  workflowId: string | undefined,
  workflowVersionId: string | undefined,
) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: [
      "workflows",
      workspaceId,
      workflowId,
      "versions",
      workflowVersionId,
    ],
    enabled:
      workspaceId !== undefined &&
      workflowId !== undefined &&
      workflowVersionId !== undefined,
    queryFn: () =>
      consoleFetch<WorkflowVersionResource>(
        `/api/v1/workflows/${workflowId}/versions/${workflowVersionId}`,
      ),
  });
}

export interface CreateWorkflowInput {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
}

export function useCreateWorkflowMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkflowInput) =>
      consoleFetch<WorkflowResource>("/api/v1/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workflows", "list"] });
    },
  });
}

export interface AppendWorkflowVersionInput {
  readonly workflowId: string;
  readonly definition: WorkflowDefinitionV3;
}

export function useAppendWorkflowVersionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AppendWorkflowVersionInput) =>
      consoleFetch<WorkflowVersionResource>(
        `/api/v1/workflows/${encodeURIComponent(input.workflowId)}/versions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ definition: input.definition }),
        },
      ),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: ["workflows", input.workflowId, "versions"],
      });
      await queryClient.invalidateQueries({ queryKey: ["workflows", "list"] });
    },
  });
}
