import { useMemo } from "react";

import type { WorkflowDefinitionView } from "../lib/workflow-definition";
import {
  resolveRootAgentInputContract,
  type ResolvedRootInputContract,
} from "../lib/workflow-root-input-contract";
import { useAgentVersionCatalogQuery } from "./use-agents";

export function useRootAgentInputContract(
  definition: WorkflowDefinitionView | undefined,
): ResolvedRootInputContract {
  const catalogQuery = useAgentVersionCatalogQuery(definition !== undefined);

  return useMemo(
    () =>
      resolveRootAgentInputContract(definition, catalogQuery.data, {
        loading: catalogQuery.isPending,
        catalogError: catalogQuery.isError,
      }),
    [
      catalogQuery.data,
      catalogQuery.isError,
      catalogQuery.isPending,
      definition,
    ],
  );
}
