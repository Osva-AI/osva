import { useEffect, useMemo, useState } from "react";

import { consoleFetch } from "../lib/console-api";
import type { WorkflowCanvasLabelContext } from "../lib/workflow-canvas-labels";
import type { AgentVersionListResource } from "./use-agents";
import { useAgentsListQuery } from "./use-agents";

export function useWorkflowCanvasLabelContext(): WorkflowCanvasLabelContext & {
  readonly isLoading: boolean;
} {
  const agentsQuery = useAgentsListQuery();
  const [agentNameByVersionId, setAgentNameByVersionId] = useState<
    Record<string, string>
  >({});
  const [agentVersionNumberByVersionId, setAgentVersionNumberByVersionId] =
    useState<Record<string, number>>({});

  const agentIdsKey = useMemo(
    () =>
      (agentsQuery.data?.agents ?? [])
        .map((agent) => agent.id)
        .sort()
        .join(","),
    [agentsQuery.data?.agents],
  );

  useEffect(() => {
    const agents = agentsQuery.data?.agents;
    if (agents === undefined || agents.length === 0) {
      setAgentNameByVersionId({});
      setAgentVersionNumberByVersionId({});
      return;
    }

    let cancelled = false;

    void (async () => {
      const names: Record<string, string> = {};
      const numbers: Record<string, number> = {};
      for (const agent of agents) {
        const versions = await consoleFetch<AgentVersionListResource>(
          `/api/v1/agents/${encodeURIComponent(agent.id)}/versions`,
        );
        for (const version of versions.versions) {
          names[version.id] = agent.name;
          numbers[version.id] = version.version;
        }
      }
      if (!cancelled) {
        setAgentNameByVersionId(names);
        setAgentVersionNumberByVersionId(numbers);
      }
    })().catch(() => {
      if (!cancelled) {
        setAgentNameByVersionId({});
        setAgentVersionNumberByVersionId({});
      }
    });

    return () => {
      cancelled = true;
    };
  }, [agentIdsKey, agentsQuery.data?.agents]);

  return {
    agentNameByVersionId,
    agentVersionNumberByVersionId,
    isLoading: agentsQuery.isLoading,
  };
}
