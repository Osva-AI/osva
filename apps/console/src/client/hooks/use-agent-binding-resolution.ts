import { useEffect, useMemo, useState } from "react";

import { consoleFetch } from "../lib/console-api";
import { resolveAgentBindingsFromCatalog } from "../lib/workflow-builder-agent-bindings";
import {
  listAgentNodesInOrder,
  type WorkflowBuilderDraft,
} from "../lib/workflow-builder-linear";
import type { AgentVersionListResource } from "./use-agents";
import { useAgentsListQuery } from "./use-agents";

export interface AgentBindingResolution {
  readonly agentIdByNodeKey: Readonly<Record<string, string>>;
  readonly unavailableVersionByNodeKey: Readonly<Record<string, boolean>>;
  readonly isResolving: boolean;
}

export function useAgentBindingResolution(
  draft: WorkflowBuilderDraft,
): AgentBindingResolution {
  const agentsQuery = useAgentsListQuery();
  const [agentIdByNodeKey, setAgentIdByNodeKey] = useState<
    Record<string, string>
  >({});
  const [unavailableVersionByNodeKey, setUnavailableVersionByNodeKey] =
    useState<Record<string, boolean>>({});
  const [isResolving, setIsResolving] = useState(false);

  const boundNodes = useMemo(() => {
    return listAgentNodesInOrder(draft).filter(
      (node) => node.agentVersionId.trim().length > 0,
    );
  }, [draft]);

  const resolutionKey = useMemo(
    () =>
      boundNodes
        .map((node) => `${node.key}:${node.agentVersionId}`)
        .sort()
        .join("|"),
    [boundNodes],
  );

  useEffect(() => {
    if (boundNodes.length === 0) {
      setAgentIdByNodeKey({});
      setUnavailableVersionByNodeKey({});
      setIsResolving(false);
      return;
    }

    if (agentsQuery.data === undefined) {
      return;
    }

    let cancelled = false;
    setIsResolving(true);

    void (async () => {
      const catalog: Array<{
        agentId: string;
        versions: ReadonlyArray<{ id: string }>;
      }> = [];

      for (const agent of agentsQuery.data.agents) {
        const versions = await consoleFetch<AgentVersionListResource>(
          `/api/v1/agents/${encodeURIComponent(agent.id)}/versions`,
        );
        catalog.push({
          agentId: agent.id,
          versions: versions.versions,
        });
      }

      if (cancelled) {
        return;
      }

      const resolved = resolveAgentBindingsFromCatalog(boundNodes, catalog);
      setAgentIdByNodeKey(resolved.agentIdByNodeKey);
      setUnavailableVersionByNodeKey(resolved.unavailableVersionByNodeKey);
      setIsResolving(false);
    })().catch(() => {
      if (!cancelled) {
        setIsResolving(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [agentsQuery.data, boundNodes, resolutionKey]);

  return {
    agentIdByNodeKey,
    unavailableVersionByNodeKey,
    isResolving: isResolving || agentsQuery.isLoading,
  };
}
