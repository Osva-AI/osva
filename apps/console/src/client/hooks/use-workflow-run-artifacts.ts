import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { ACTIVE_RUN_POLL_MS } from "../lib/query-client";
import type { WorkflowDefinitionView } from "../lib/workflow-definition";
import {
  collectAgentChildRuns,
  collectExplicitArtifactReferences,
  isAgentNodeType,
  loadWorkflowRunArtifacts,
  type WorkflowRunArtifactsResult,
} from "../lib/workflow-artifacts";
import type { ArtifactListResource, ArtifactResource } from "./use-runs";
import { workspaceScopedFetch } from "../lib/console-api";
import type { WorkflowNodeRunResource } from "./use-workflow-runs";
import { useWorkspaceQueryScope } from "./use-workspace-query-scope";

export function useWorkflowRunArtifactsQuery(input: {
  readonly workflowRunId: string | undefined;
  readonly definition: WorkflowDefinitionView | undefined;
  readonly nodeRuns: readonly WorkflowNodeRunResource[] | undefined;
  readonly workflowOutput: unknown;
  readonly live: boolean;
}) {
  const workspaceId = useWorkspaceQueryScope();
  const childRuns = useMemo(() => {
    if (input.definition === undefined || input.nodeRuns === undefined) {
      return [];
    }
    return collectAgentChildRuns(input.definition, input.nodeRuns);
  }, [input.definition, input.nodeRuns]);

  const referenceIds = useMemo(() => {
    const outputs: unknown[] = [];
    if (input.workflowOutput !== undefined) {
      outputs.push(input.workflowOutput);
    }
    if (input.definition !== undefined && input.nodeRuns !== undefined) {
      const agentKeys = new Set(
        input.definition.nodes
          .filter((node) => isAgentNodeType(node.type))
          .map((node) => node.key),
      );
      for (const nodeRun of input.nodeRuns) {
        if (
          agentKeys.has(nodeRun.workflowNodeKey) &&
          nodeRun.output !== undefined
        ) {
          outputs.push(nodeRun.output);
        }
      }
    }
    return collectExplicitArtifactReferences(outputs);
  }, [input.definition, input.nodeRuns, input.workflowOutput]);

  const childRunKey = childRuns.map((child) => child.childRunId).join(",");

  return useQuery({
    queryKey: [
      "workflow-runs",
      workspaceId,
      input.workflowRunId,
      "artifacts",
      childRunKey,
      referenceIds,
    ],
    enabled:
      workspaceId !== undefined &&
      input.workflowRunId !== undefined &&
      input.definition !== undefined,
    queryFn: (): Promise<WorkflowRunArtifactsResult> => {
      const definition = input.definition;
      if (definition === undefined) {
        throw new Error(
          "Workflow definition is required to associate artifacts.",
        );
      }
      return loadWorkflowRunArtifacts({
        definition,
        childRuns,
        referenceIds,
        fetchPage: (path, signal) =>
          workspaceScopedFetch<ArtifactListResource>(workspaceId, path, {
            signal,
          }),
        fetchArtifact: (artifactId, signal) =>
          workspaceScopedFetch<ArtifactResource>(
            workspaceId,
            `/api/v1/artifacts/${encodeURIComponent(artifactId)}`,
            { signal },
          ),
      });
    },
    refetchInterval: input.live ? ACTIVE_RUN_POLL_MS : false,
  });
}
