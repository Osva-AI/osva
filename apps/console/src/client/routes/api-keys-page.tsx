import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { COMMUNITY_EDITION_ROLES } from "@osva-ai/contracts";

import { useAuth, useWorkspaceAccess } from "../context/auth-context";
import {
  ConsoleApiError,
  workspaceMutationFetch,
  workspaceScopedFetch,
} from "../lib/console-api";
import { roleCanManageApiKeys } from "../lib/permissions";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Button } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";

interface ApiKeyRow {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
}

const ASSIGNABLE_ROLES = [
  COMMUNITY_EDITION_ROLES.OPERATOR,
  COMMUNITY_EDITION_ROLES.EDITOR,
  COMMUNITY_EDITION_ROLES.ADMIN,
  COMMUNITY_EDITION_ROLES.VIEWER,
] as const;

export function ApiKeysPage() {
  const access = useWorkspaceAccess();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>(COMMUNITY_EDITION_ROLES.OPERATOR);
  const [expiresAt, setExpiresAt] = useState("");
  const [plaintextToken, setPlaintextToken] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [pendingRevoke, setPendingRevoke] = useState<ApiKeyRow | undefined>();
  const [revokePending, setRevokePending] = useState(false);

  const workspaceId = access?.workspaceId;
  const canManage = access !== undefined && roleCanManageApiKeys(access.role);

  const keysQuery = useQuery({
    queryKey: ["workspace", workspaceId, "api-keys"],
    enabled: workspaceId !== undefined && canManage,
    queryFn: async () => {
      const body = await workspaceScopedFetch<{ apiKeys: ApiKeyRow[] }>(
        workspaceId,
        "/api/v1/api-keys",
      );
      return body.apiKeys;
    },
  });

  if (access === undefined || auth.sessionQuery.isLoading) {
    return <LoadingBlock label="Loading workspace…" />;
  }

  if (!canManage) {
    return (
      <ErrorState
        title="Permission denied"
        error={
          new ConsoleApiError(403, {
            error: "ADMIN access is required to manage machine API keys.",
          })
        }
      />
    );
  }

  async function invalidateKeys(): Promise<void> {
    await queryClient.invalidateQueries({
      queryKey: ["workspace", workspaceId, "api-keys"],
    });
  }

  async function createKey(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setPlaintextToken(undefined);
    try {
      const created = await workspaceMutationFetch<{
        token: string;
        apiKey: ApiKeyRow;
      }>("/api/v1/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          role,
          ...(expiresAt.trim().length > 0
            ? { expiresAt: new Date(expiresAt).toISOString() }
            : {}),
        }),
      });
      setPlaintextToken(created.token);
      setName("");
      setExpiresAt("");
      await invalidateKeys();
    } catch (createError) {
      setError(
        createError instanceof ConsoleApiError
          ? createError.message
          : "Could not create API key.",
      );
    }
  }

  async function confirmRevoke(): Promise<void> {
    if (pendingRevoke === undefined) {
      return;
    }
    setRevokePending(true);
    try {
      await workspaceMutationFetch(
        `/api/v1/api-keys/${pendingRevoke.id}/revoke`,
        { method: "POST" },
      );
      setPendingRevoke(undefined);
      await invalidateKeys();
    } catch (revokeError) {
      setError(
        revokeError instanceof ConsoleApiError
          ? revokeError.message
          : "Could not revoke API key.",
      );
    } finally {
      setRevokePending(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="API Keys"
        subtitle="Machine credentials for CLI and SDK access. These are not the same as your human sign-in session."
      />

      {keysQuery.error instanceof ConsoleApiError &&
      keysQuery.error.status === 401 ? (
        <ErrorState title="Session expired" error={keysQuery.error} />
      ) : null}

      <section className="panel">
        <h2>Create machine API key</h2>
        <p className="muted">
          The secret is shown once after creation. It is not stored in the
          browser.
        </p>
        <form className="form-stack" onSubmit={createKey}>
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={128}
            />
          </label>
          <label>
            Role
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              {ASSIGNABLE_ROLES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <label>
            Expires (optional)
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </label>
          <Button type="submit" variant="primary">
            Create API key
          </Button>
        </form>
        {error !== undefined ? <p className="error-text">{error}</p> : null}
      </section>

      {plaintextToken !== undefined ? (
        <div className="setup-token-panel" role="status">
          <p>Copy this machine API key now. It will not be shown again.</p>
          <pre className="mono">{plaintextToken}</pre>
          <button type="button" onClick={() => setPlaintextToken(undefined)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <section className="panel">
        <h2>Workspace keys</h2>
        {keysQuery.isLoading ? (
          <LoadingBlock label="Loading API keys…" />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Created</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(keysQuery.data ?? []).map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.role}</td>
                  <td className="mono">{row.createdAt}</td>
                  <td>{row.revokedAt !== undefined ? "Revoked" : "Active"}</td>
                  <td>
                    {row.revokedAt === undefined ? (
                      <Button
                        type="button"
                        variant="danger"
                        onClick={() => setPendingRevoke(row)}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <ConfirmDialog
        open={pendingRevoke !== undefined}
        title="Revoke API key"
        description={`Revoke "${pendingRevoke?.name ?? ""}"? Existing clients using this key will receive HTTP 401.`}
        confirmLabel="Revoke"
        pending={revokePending}
        onCancel={() => setPendingRevoke(undefined)}
        onConfirm={() => {
          void confirmRevoke();
        }}
      />
    </div>
  );
}
