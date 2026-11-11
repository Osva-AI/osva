import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useAuth } from "../../context/auth-context";
import { workspaceMutationFetch } from "../../lib/console-api";
import { Button } from "../ui/button";

export function WorkspaceManagementPanel() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const workspace = auth.selectedWorkspace;
  const organizationId = workspace?.organizationId;
  const isOwner = workspace?.role === "OWNER";
  const canRename = workspace?.role === "OWNER" || workspace?.role === "ADMIN";

  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [renameValue, setRenameValue] = useState(workspace?.name ?? "");

  const createMutation = useMutation({
    mutationFn: async () => {
      if (organizationId === undefined) {
        throw new Error(
          "Organization context is required to create a workspace.",
        );
      }
      return workspaceMutationFetch<{
        workspace: { workspaceId: string; name: string };
      }>("/api/v1/auth/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          name: newWorkspaceName.trim(),
        }),
      });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["auth", "workspaces"] });
      setNewWorkspaceName("");
      auth.selectWorkspace(result.workspace.workspaceId);
    },
  });

  const renameMutation = useMutation({
    mutationFn: async () => {
      if (workspace === undefined) {
        throw new Error("Select a workspace before renaming.");
      }
      const pinnedWorkspaceId = workspace.workspaceId;
      return workspaceMutationFetch<{ workspace: { name: string } }>(
        `/api/v1/auth/workspaces/${encodeURIComponent(pinnedWorkspaceId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: renameValue.trim() }),
        },
        { workspaceId: pinnedWorkspaceId },
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth", "workspaces"] });
    },
  });

  if (!isOwner && !canRename) {
    return null;
  }

  return (
    <div className="panel-stack">
      {isOwner ? (
        <div className="form-row">
          <label className="field-label" htmlFor="new-workspace-name">
            Create workspace
          </label>
          <input
            id="new-workspace-name"
            className="text-input"
            value={newWorkspaceName}
            onChange={(event) => {
              setNewWorkspaceName(event.target.value);
            }}
            placeholder="Workspace name"
          />
          <Button
            type="button"
            disabled={
              newWorkspaceName.trim().length === 0 || createMutation.isPending
            }
            onClick={() => {
              createMutation.mutate();
            }}
          >
            Create
          </Button>
        </div>
      ) : null}
      {canRename && workspace !== undefined ? (
        <div className="form-row">
          <label className="field-label" htmlFor="rename-workspace">
            Rename this workspace
          </label>
          <input
            id="rename-workspace"
            className="text-input"
            value={renameValue}
            onChange={(event) => {
              setRenameValue(event.target.value);
            }}
          />
          <Button
            type="button"
            disabled={
              renameValue.trim().length === 0 ||
              renameValue.trim() === workspace.name ||
              renameMutation.isPending
            }
            onClick={() => {
              renameMutation.mutate();
            }}
          >
            Save name
          </Button>
        </div>
      ) : null}
    </div>
  );
}
