import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  HUMAN_WORKSPACE_ROLES,
  MANAGEABLE_HUMAN_WORKSPACE_ROLES,
} from "@osva-ai/contracts";

import { useAuth, useWorkspaceAccess } from "../context/auth-context";
import { consoleFetch, ConsoleApiError } from "../lib/console-api";
import {
  roleCanManageMembers,
  roleCanTransferOwnership,
} from "../lib/permissions";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";

interface MembershipRow {
  readonly id: string;
  readonly userId: string;
  readonly role: string;
}

export function WorkspaceAccessPage() {
  const access = useWorkspaceAccess();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<string>(HUMAN_WORKSPACE_ROLES.VIEWER);
  const [setupToken, setSetupToken] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pendingRole, setPendingRole] = useState<Record<string, string>>({});
  const [transferTargetUserId, setTransferTargetUserId] = useState("");

  const canTransfer =
    access !== undefined && roleCanTransferOwnership(access.role);

  const membershipsQuery = useQuery({
    queryKey: ["auth", "memberships", access?.workspaceId],
    enabled: access !== undefined && roleCanManageMembers(access.role),
    queryFn: async () => {
      const body = await consoleFetch<{ memberships: MembershipRow[] }>(
        `/api/v1/auth/workspaces/${access!.workspaceId}/memberships`,
      );
      return body.memberships;
    },
  });

  if (access === undefined) {
    return <LoadingBlock label="Loading workspace…" />;
  }

  if (!roleCanManageMembers(access.role)) {
    return (
      <ErrorState
        title="Permission denied"
        error={
          new ConsoleApiError(403, {
            error: "Manage members permission is required.",
          })
        }
      />
    );
  }

  async function invalidateMemberships(): Promise<void> {
    await queryClient.invalidateQueries({
      queryKey: ["auth", "memberships", access!.workspaceId],
    });
  }

  async function provisionMember(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setSetupToken(undefined);
    try {
      const created = await consoleFetch<{
        setupToken: string;
        user: { userId: string };
      }>(`/api/v1/auth/workspaces/${access!.workspaceId}/members/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, displayName, role }),
      });
      setSetupToken(created.setupToken);
      setEmail("");
      setDisplayName("");
      await invalidateMemberships();
    } catch (provisionError) {
      setError(
        provisionError instanceof ConsoleApiError
          ? provisionError.message
          : "Could not provision member.",
      );
    }
  }

  async function changeRole(membership: MembershipRow): Promise<void> {
    const nextRole = pendingRole[membership.id] ?? membership.role;
    if (
      !window.confirm(`Change role for ${membership.userId} to ${nextRole}?`)
    ) {
      return;
    }
    setRowErrors((current) => ({ ...current, [membership.id]: "" }));
    try {
      await consoleFetch(
        `/api/v1/auth/workspaces/${access!.workspaceId}/memberships/${membership.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: nextRole }),
        },
      );
      await invalidateMemberships();
    } catch (changeError) {
      setRowErrors((current) => ({
        ...current,
        [membership.id]:
          changeError instanceof ConsoleApiError
            ? changeError.message
            : "Could not change role.",
      }));
    }
  }

  async function removeMember(membership: MembershipRow): Promise<void> {
    if (
      !window.confirm(
        `Remove ${membership.userId} from this workspace? This cannot be undone.`,
      )
    ) {
      return;
    }
    setRowErrors((current) => ({ ...current, [membership.id]: "" }));
    try {
      await consoleFetch(
        `/api/v1/auth/workspaces/${access!.workspaceId}/memberships/${membership.id}`,
        { method: "DELETE" },
      );
      await invalidateMemberships();
    } catch (removeError) {
      setRowErrors((current) => ({
        ...current,
        [membership.id]:
          removeError instanceof ConsoleApiError
            ? removeError.message
            : "Could not remove member.",
      }));
    }
  }

  async function grantOwner(membership: MembershipRow): Promise<void> {
    if (
      !window.confirm(
        `Promote ${membership.userId} to OWNER? You will remain an owner until ownership is transferred or you are demoted.`,
      )
    ) {
      return;
    }
    setRowErrors((current) => ({ ...current, [membership.id]: "" }));
    try {
      await consoleFetch(
        `/api/v1/auth/workspaces/${access!.workspaceId}/memberships/${membership.id}/grant-owner`,
        { method: "POST" },
      );
      await invalidateMemberships();
    } catch (grantError) {
      setRowErrors((current) => ({
        ...current,
        [membership.id]:
          grantError instanceof ConsoleApiError
            ? grantError.message
            : "Could not grant owner.",
      }));
    }
  }

  async function transferOwnership(): Promise<void> {
    if (transferTargetUserId.trim().length === 0) {
      setError("Select a member to receive ownership.");
      return;
    }
    if (
      !window.confirm(
        `Transfer workspace ownership to ${transferTargetUserId}? Your role may change depending on server policy.`,
      )
    ) {
      return;
    }
    setError(undefined);
    try {
      await consoleFetch(
        `/api/v1/auth/workspaces/${access!.workspaceId}/ownership/transfer`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ toUserId: transferTargetUserId }),
        },
      );
      setTransferTargetUserId("");
      await invalidateMemberships();
      await queryClient.invalidateQueries({ queryKey: ["auth", "workspaces"] });
    } catch (transferError) {
      setError(
        transferError instanceof ConsoleApiError
          ? transferError.message
          : "Could not transfer ownership.",
      );
    }
  }

  function actorCanEditRow(row: MembershipRow): boolean {
    if (row.role === HUMAN_WORKSPACE_ROLES.OWNER) {
      return canTransfer;
    }
    return true;
  }

  return (
    <section>
      <h1>Workspace access</h1>
      <p>
        Workspace <span className="mono">{access.workspaceId}</span> · your role{" "}
        <span className="mono">{access.role}</span>
      </p>

      {membershipsQuery.isLoading ? (
        <LoadingBlock label="Loading memberships…" />
      ) : membershipsQuery.isError ? (
        <ErrorState
          title="Could not load memberships"
          error={membershipsQuery.error}
        />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Membership</th>
              <th>User</th>
              <th>Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {membershipsQuery.data?.map((row) => {
              const isOwnerRow = row.role === HUMAN_WORKSPACE_ROLES.OWNER;
              const editable = actorCanEditRow(row);
              const selectedRole = pendingRole[row.id] ?? row.role;
              return (
                <tr key={row.id}>
                  <td className="mono">{row.id}</td>
                  <td className="mono">{row.userId}</td>
                  <td>
                    {editable && !isOwnerRow ? (
                      <select
                        aria-label={`Role for ${row.userId}`}
                        value={selectedRole}
                        onChange={(event) =>
                          setPendingRole((current) => ({
                            ...current,
                            [row.id]: event.target.value,
                          }))
                        }
                      >
                        {MANAGEABLE_HUMAN_WORKSPACE_ROLES.map((candidate) => (
                          <option key={candidate} value={candidate}>
                            {candidate}
                          </option>
                        ))}
                      </select>
                    ) : (
                      row.role
                    )}
                  </td>
                  <td>
                    {editable && !isOwnerRow ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void changeRole(row)}
                        >
                          Save role
                        </button>{" "}
                        <button
                          type="button"
                          onClick={() => void removeMember(row)}
                        >
                          Remove
                        </button>{" "}
                        {canTransfer ? (
                          <button
                            type="button"
                            onClick={() => void grantOwner(row)}
                          >
                            Promote to owner
                          </button>
                        ) : null}
                      </>
                    ) : null}
                    {isOwnerRow && !canTransfer ? (
                      <span className="muted">
                        Only an owner can change or remove owners.
                      </span>
                    ) : null}
                    {rowErrors[row.id] ? (
                      <p className="form-error">{rowErrors[row.id]}</p>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {canTransfer ? (
        <section>
          <h2>Transfer ownership</h2>
          <label>
            New owner user id
            <select
              value={transferTargetUserId}
              onChange={(event) => setTransferTargetUserId(event.target.value)}
            >
              <option value="">Select member…</option>
              {membershipsQuery.data
                ?.filter(
                  (row) =>
                    row.role !== HUMAN_WORKSPACE_ROLES.OWNER &&
                    row.userId !== auth.user?.userId,
                )
                .map((row) => (
                  <option key={row.userId} value={row.userId}>
                    {row.userId}
                  </option>
                ))}
            </select>
          </label>
          <button type="button" onClick={() => void transferOwnership()}>
            Transfer ownership
          </button>
        </section>
      ) : null}

      <h2>Provision user</h2>
      <form onSubmit={(event) => void provisionMember(event)}>
        <label>
          Email
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Display name
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
        </label>
        <label>
          Role
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            {MANAGEABLE_HUMAN_WORKSPACE_ROLES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
        </label>
        {error !== undefined ? <p className="form-error">{error}</p> : null}
        <button type="submit">Provision</button>
      </form>

      {setupToken !== undefined ? (
        <div className="setup-token-panel" role="status">
          <p>Copy this one-time setup token now. It will not be shown again.</p>
          <code>{setupToken}</code>
          <button type="button" onClick={() => setSetupToken(undefined)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <p>
        Signed in as {auth.user?.email ?? auth.session?.userId}. Destructive
        membership changes require confirmation.
      </p>
    </section>
  );
}
