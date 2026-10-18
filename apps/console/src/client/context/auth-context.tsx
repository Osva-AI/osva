import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { consoleFetch, ConsoleApiError } from "../lib/console-api";
import {
  clearSelectedWorkspaceId,
  getSelectedWorkspaceId,
  reconcileSelectedWorkspace,
  setSelectedWorkspaceId,
} from "../lib/workspace-selection";

export interface HumanSession {
  readonly userId: string;
  readonly sessionId: string;
  readonly expiresAt: string;
}

export interface HumanUserProfile {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: string;
}

export interface WorkspaceMembershipSummary {
  readonly workspaceId: string;
  readonly name: string;
  readonly role: string;
}

interface AuthContextValue {
  readonly session: HumanSession | undefined;
  readonly user: HumanUserProfile | undefined;
  readonly workspaces: readonly WorkspaceMembershipSummary[];
  readonly selectedWorkspaceId: string | undefined;
  readonly selectedWorkspace: WorkspaceMembershipSummary | undefined;
  readonly sessionQuery: ReturnType<typeof useQuery<HumanSession>>;
  readonly isAuthenticated: boolean;
  readonly selectWorkspace: (workspaceId: string) => void;
  readonly logout: () => Promise<void>;
  readonly clearAuthState: () => void;
}

const AuthReactContext = createContext<AuthContextValue | undefined>(undefined);

function subscribeToWorkspaceSelection(onStoreChange: () => void): () => void {
  const handler = (): void => {
    onStoreChange();
  };
  window.addEventListener("storage", handler);
  window.addEventListener("osva-workspace-selected", handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("osva-workspace-selected", handler);
  };
}

function readWorkspaceSelectionSnapshot(): string | undefined {
  return getSelectedWorkspaceId();
}

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const queryClient = useQueryClient();
  const selectedWorkspaceId = useSyncExternalStore(
    subscribeToWorkspaceSelection,
    readWorkspaceSelectionSnapshot,
    () => undefined,
  );

  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: () => consoleFetch<HumanSession>("/api/v1/auth/session"),
    retry: false,
    staleTime: 30_000,
  });

  const userQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => consoleFetch<HumanUserProfile>("/api/v1/auth/me"),
    enabled: sessionQuery.isSuccess,
    staleTime: 60_000,
  });

  const workspacesQuery = useQuery({
    queryKey: ["auth", "workspaces"],
    queryFn: async () => {
      const body = await consoleFetch<{
        workspaces: WorkspaceMembershipSummary[];
      }>("/api/v1/auth/workspaces");
      return body.workspaces;
    },
    enabled: sessionQuery.isSuccess,
    staleTime: 30_000,
  });

  const workspaces = workspacesQuery.data ?? [];
  const authorizedIds = useMemo(
    () => workspaces.map((workspace) => workspace.workspaceId),
    [workspaces],
  );

  const reconciledSelection = useMemo(() => {
    if (authorizedIds.length === 0) {
      return undefined;
    }
    return reconcileSelectedWorkspace(authorizedIds) ?? selectedWorkspaceId;
  }, [authorizedIds, selectedWorkspaceId]);

  const selectedWorkspace = workspaces.find(
    (workspace) => workspace.workspaceId === reconciledSelection,
  );

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      setSelectedWorkspaceId(workspaceId);
      window.dispatchEvent(new Event("osva-workspace-selected"));
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== "auth",
      });
    },
    [queryClient],
  );

  const clearAuthState = useCallback(() => {
    clearSelectedWorkspaceId();
    queryClient.clear();
  }, [queryClient]);

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await consoleFetch("/api/v1/auth/logout", { method: "POST" });
    },
    onSettled: () => {
      clearAuthState();
    },
  });

  const value = useMemo(
    (): AuthContextValue => ({
      session: sessionQuery.data,
      user: userQuery.data,
      workspaces,
      selectedWorkspaceId: reconciledSelection,
      selectedWorkspace,
      sessionQuery,
      isAuthenticated: sessionQuery.isSuccess,
      selectWorkspace,
      logout: async () => {
        await logoutMutation.mutateAsync();
      },
      clearAuthState,
    }),
    [
      sessionQuery.data,
      sessionQuery.isSuccess,
      userQuery.data,
      workspaces,
      reconciledSelection,
      selectedWorkspace,
      sessionQuery,
      selectWorkspace,
      logoutMutation,
      clearAuthState,
    ],
  );

  return (
    <AuthReactContext.Provider value={value}>
      {children}
    </AuthReactContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthReactContext);
  if (value === undefined) {
    throw new Error("useAuth must be used within AuthProvider.");
  }
  return value;
}

export function useWorkspaceAccess():
  | {
      readonly workspaceId: string;
      readonly role: string;
      readonly userId: string;
    }
  | undefined {
  const auth = useAuth();
  if (auth.selectedWorkspace === undefined || auth.session === undefined) {
    return undefined;
  }
  return {
    workspaceId: auth.selectedWorkspace.workspaceId,
    role: auth.selectedWorkspace.role,
    userId: auth.session.userId,
  };
}

export function handleConsoleAuthError(
  error: unknown,
  auth: AuthContextValue,
): "login" | "select-workspace" | "forbidden" | "none" {
  if (!(error instanceof ConsoleApiError)) {
    return "none";
  }
  if (error.status === 401) {
    auth.clearAuthState();
    return "login";
  }
  if (
    error.status === 400 &&
    error.body.code === "workspace_selection_required"
  ) {
    return "select-workspace";
  }
  if (error.status === 403) {
    return "forbidden";
  }
  return "none";
}
