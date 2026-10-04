import { useQuery } from "@tanstack/react-query";

import { consoleFetch } from "../lib/console-api";

export interface AuthContext {
  readonly subjectId: string;
  readonly workspaceId: string;
  readonly role: string;
}

export function useAuthContextQuery() {
  return useQuery({
    queryKey: ["auth", "context"],
    queryFn: () => consoleFetch<AuthContext>("/api/v1/auth/context"),
    staleTime: 60_000,
  });
}
