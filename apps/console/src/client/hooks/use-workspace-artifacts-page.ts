import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { workspaceScopedFetch } from "../lib/console-api";
import type { ArtifactListResource } from "./use-runs";
import { useWorkspaceQueryScope } from "./use-workspace-query-scope";

export const WORKSPACE_ARTIFACT_PAGE_LIMIT = 50;

function buildArtifactsPagePath(
  cursor: string | undefined,
  limit = WORKSPACE_ARTIFACT_PAGE_LIMIT,
): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor !== undefined && cursor.length > 0) {
    params.set("cursor", cursor);
  }
  return `/api/v1/artifacts?${params.toString()}`;
}

export function useWorkspaceArtifactsPageQuery() {
  const workspaceId = useWorkspaceQueryScope();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<readonly string[]>([]);

  const query = useQuery({
    queryKey: ["artifacts", workspaceId, "workspace-page", cursor],
    enabled: workspaceId !== undefined,
    queryFn: () =>
      workspaceScopedFetch<ArtifactListResource>(
        workspaceId,
        buildArtifactsPagePath(cursor),
      ),
  });

  function goNext() {
    const next = query.data?.nextCursor;
    if (next === undefined) {
      return;
    }
    setCursorStack((stack) => [...stack, cursor ?? ""]);
    setCursor(next);
  }

  function goPrevious() {
    setCursorStack((stack) => {
      if (stack.length === 0) {
        setCursor(undefined);
        return stack;
      }
      const previous = stack.at(-1)!;
      setCursor(previous.length > 0 ? previous : undefined);
      return stack.slice(0, -1);
    });
  }

  return {
    ...query,
    cursor,
    canGoPrevious: cursorStack.length > 0 || cursor !== undefined,
    canGoNext: query.data?.nextCursor !== undefined,
    goNext,
    goPrevious,
    truncated: query.data?.nextCursor !== undefined,
  };
}
