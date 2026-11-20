import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  InferenceBudgetPolicyDefinitionV1,
  InferenceBudgetPeriodKeyV1,
} from "@osva-ai/contracts";

import {
  workspaceMutationFetch,
  workspaceScopedFetch,
} from "../lib/console-api";
import { useWorkspaceQueryScope } from "./use-workspace-query-scope";

export interface InferenceBudgetPolicyResource {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly createdAt: string;
}

export interface InferenceBudgetPolicyVersionResource {
  readonly id: string;
  readonly policyId: string;
  readonly workspaceId: string;
  readonly version: number;
  readonly definition: InferenceBudgetPolicyDefinitionV1;
  readonly createdAt: string;
}

export interface WorkspaceInferenceBudgetConfigurationResource {
  readonly activation: {
    readonly enabled: boolean;
    readonly activePolicyVersionId?: string;
    readonly updatedAt: string;
  };
  readonly runtimePolicy: {
    readonly enabled: boolean;
    readonly policyVersionId?: string;
  };
  readonly activationMutationsPermitted: boolean;
}

export interface InferenceBudgetPeriodUsageResource {
  readonly period: {
    readonly periodKind: string;
    readonly periodKey: string;
    readonly periodStartUtc: string;
    readonly periodEndExclusiveUtc: string;
  };
  readonly ledger: {
    readonly limitUsdMicros: number;
    readonly committedLiabilityUsdMicros: number;
    readonly heldReservationsUsdMicros: number;
    readonly unresolvedUncertainLiabilityUsdMicros: number;
    readonly overageUsdMicros: number;
    readonly budgetPolicyVersionId: string;
  } | null;
  readonly availableReservationCapacityUsdMicros: number | null;
  readonly liabilityAccountingKind: "ESTIMATED_RESERVATION_LIABILITY";
}

const budgetQueryRoot = "inference-budget";

export function useInferenceBudgetPoliciesListQuery() {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: [budgetQueryRoot, workspaceId, "policies"],
    enabled: workspaceId !== undefined,
    queryFn: () =>
      workspaceScopedFetch<{ policies: InferenceBudgetPolicyResource[] }>(
        workspaceId,
        "/api/v1/inference-budget-policies",
      ),
  });
}

export function useCreateInferenceBudgetPolicyMutation() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceQueryScope();
  return useMutation({
    mutationFn: (body: {
      readonly key: string;
      readonly definition: InferenceBudgetPolicyDefinitionV1;
    }) =>
      workspaceMutationFetch<{
        policy: InferenceBudgetPolicyResource;
        version: InferenceBudgetPolicyVersionResource | null;
      }>("/api/v1/inference-budget-policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: [budgetQueryRoot, workspaceId],
      });
    },
  });
}

export function useInferenceBudgetPolicyVersionsQuery(
  policyId: string | undefined,
) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: [budgetQueryRoot, workspaceId, policyId, "versions"],
    enabled: workspaceId !== undefined && policyId !== undefined,
    queryFn: () =>
      workspaceScopedFetch<{
        versions: InferenceBudgetPolicyVersionResource[];
      }>(
        workspaceId,
        `/api/v1/inference-budget-policies/${encodeURIComponent(policyId ?? "")}/versions`,
      ),
  });
}

export function useInferenceBudgetPolicyVersionQuery(
  policyVersionId: string | undefined,
) {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: [budgetQueryRoot, workspaceId, "policy-version", policyVersionId],
    enabled: workspaceId !== undefined && policyVersionId !== undefined,
    queryFn: () =>
      workspaceScopedFetch<InferenceBudgetPolicyVersionResource>(
        workspaceId,
        `/api/v1/inference-budget-policy-versions/${encodeURIComponent(policyVersionId ?? "")}`,
      ),
  });
}

export function useAppendInferenceBudgetPolicyVersionMutation(
  policyId: string,
) {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceQueryScope();
  return useMutation({
    mutationFn: (body: {
      readonly definition: InferenceBudgetPolicyDefinitionV1;
    }) =>
      workspaceMutationFetch<InferenceBudgetPolicyVersionResource>(
        `/api/v1/inference-budget-policies/${encodeURIComponent(policyId)}/versions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: [budgetQueryRoot, workspaceId],
      });
    },
  });
}

export function useWorkspaceInferenceBudgetConfigurationQuery() {
  const workspaceId = useWorkspaceQueryScope();
  return useQuery({
    queryKey: [budgetQueryRoot, workspaceId, "configuration"],
    enabled: workspaceId !== undefined,
    queryFn: () =>
      workspaceScopedFetch<WorkspaceInferenceBudgetConfigurationResource>(
        workspaceId,
        "/api/v1/workspace-inference-budget/configuration",
      ),
  });
}

export function useActivateWorkspaceInferenceBudgetMutation() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceQueryScope();
  return useMutation({
    mutationFn: (body: { readonly policyVersionId: string }) =>
      workspaceMutationFetch<WorkspaceInferenceBudgetConfigurationResource>(
        "/api/v1/workspace-inference-budget/activate",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: [budgetQueryRoot, workspaceId],
      });
    },
  });
}

export function useDisableWorkspaceInferenceBudgetMutation() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceQueryScope();
  return useMutation({
    mutationFn: () =>
      workspaceMutationFetch<WorkspaceInferenceBudgetConfigurationResource>(
        "/api/v1/workspace-inference-budget/disable",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: [budgetQueryRoot, workspaceId],
      });
    },
  });
}

export function useInferenceBudgetPeriodUsageQuery(
  periodKey?: InferenceBudgetPeriodKeyV1,
  options?: { readonly enabled?: boolean },
) {
  const workspaceId = useWorkspaceQueryScope();
  const suffix =
    periodKey === undefined
      ? ""
      : `?periodKey=${encodeURIComponent(periodKey)}`;
  return useQuery({
    queryKey: [
      budgetQueryRoot,
      workspaceId,
      "period-usage",
      periodKey ?? "current",
    ],
    enabled: workspaceId !== undefined && (options?.enabled ?? true),
    queryFn: () =>
      workspaceScopedFetch<InferenceBudgetPeriodUsageResource>(
        workspaceId,
        `/api/v1/workspace-inference-budget/period-usage${suffix}`,
      ),
  });
}
