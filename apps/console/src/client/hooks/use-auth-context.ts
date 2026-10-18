import { useQuery } from "@tanstack/react-query";

import { consoleFetch } from "../lib/console-api";
import type { HumanSession } from "../context/auth-context";
import { useWorkspaceQueryScope } from "./use-workspace-query-scope";

export interface AuthContext {
  readonly subjectId: string;
  readonly workspaceId: string;
  readonly role: string;
}

export function useAuthContextQuery() {
  const workspaceId = useWorkspaceQueryScope();

  return useQuery({
    queryKey: ["auth", "context", workspaceId],
    enabled: workspaceId !== undefined,
    queryFn: async (): Promise<AuthContext> => {
      const session = await consoleFetch<HumanSession>("/api/v1/auth/session");
      const workspaces = await consoleFetch<{
        workspaces: Array<{
          readonly workspaceId: string;
          readonly role: string;
        }>;
      }>("/api/v1/auth/workspaces");
      const membership = workspaces.workspaces.find(
        (workspace) => workspace.workspaceId === workspaceId,
      );
      if (membership === undefined) {
        throw new Error("Selected workspace is not authorized.");
      }
      return {
        subjectId: session.userId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      };
    },
    staleTime: 30_000,
  });
}
