import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { WorkflowDefinitionV3 } from "@osva-ai/contracts";

import {
  workspaceScopedFetch,
  workspaceMutationFetch,
} from "../lib/console-api";
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
    queryFn: () =>
      workspaceScopedFetch<WorkflowListResource>(
        workspaceId,
        "/api/v1/workflows",
      ),
  });
}

export function useWorkflowQuery(workflowId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["workflows", workspaceId, workflowId],
    enabled: workspaceId !== undefined && workflowId !== undefined,
    queryFn: () =>
      workspaceScopedFetch<WorkflowResource>(
        workspaceId,
        `/api/v1/workflows/${workflowId}`,
      ),
  });
}

export function useWorkflowVersionsQuery(workflowId: string | undefined) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["workflows", workspaceId, workflowId, "versions"],
    enabled: workspaceId !== undefined && workflowId !== undefined,
    queryFn: () =>
      workspaceScopedFetch<WorkflowVersionListResource>(
        workspaceId,
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
      workspaceScopedFetch<WorkflowVersionResource>(
        workspaceId,
        `/api/v1/workflows/${workflowId}/versions/${workflowVersionId}`,
      ),
  });
}

export interface WorkflowVersionCatalogResource {
  readonly entries: ReadonlyArray<{
    readonly workflowId: string;
    readonly versions: readonly WorkflowVersionResource[];
  }>;
}

export function useWorkflowVersionCatalogQuery(enabled = true) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: ["workflows", workspaceId, "version-catalog"],
    enabled: enabled && workspaceId !== undefined,
    queryFn: async (): Promise<WorkflowVersionCatalogResource> => {
      const listed = await workspaceScopedFetch<WorkflowListResource>(
        workspaceId,
        "/api/v1/workflows",
      );
      const entries: Array<{
        readonly workflowId: string;
        readonly versions: readonly WorkflowVersionResource[];
      }> = [];
      for (const workflow of listed.workflows) {
        const versions =
          await workspaceScopedFetch<WorkflowVersionListResource>(
            workspaceId,
            `/api/v1/workflows/${encodeURIComponent(workflow.id)}/versions`,
          );
        entries.push({
          workflowId: workflow.id,
          versions: versions.versions,
        });
      }
      return { entries };
    },
  });
}

export interface CreateWorkflowInput {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
}

export function useCreateWorkflowMutation() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceQueryScope();
  return useMutation({
    mutationFn: (input: CreateWorkflowInput) =>
      workspaceMutationFetch<WorkflowResource>("/api/v1/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      if (workspaceId === undefined) {
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: ["workflows", workspaceId, "list"],
      });
    },
  });
}

export interface AppendWorkflowVersionInput {
  readonly workflowId: string;
  readonly definition: WorkflowDefinitionV3;
}

export function useAppendWorkflowVersionMutation() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceQueryScope();
  return useMutation({
    mutationFn: (input: AppendWorkflowVersionInput) =>
      workspaceMutationFetch<WorkflowVersionResource>(
        `/api/v1/workflows/${encodeURIComponent(input.workflowId)}/versions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ definition: input.definition }),
        },
      ),
    onSuccess: async (_data, input) => {
      if (workspaceId === undefined) {
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: ["workflows", workspaceId, input.workflowId, "versions"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["workflows", workspaceId, "list"],
      });
    },
  });
}
