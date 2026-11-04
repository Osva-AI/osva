import { useState } from "react";
import { Link } from "react-router-dom";

import { ModelsConceptsPanel } from "../components/models/models-concepts-panel";
import { ModelsSectionNav } from "../components/models/models-section-nav";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { LinkButton } from "../components/ui/button";
import { Button } from "../components/ui/button";
import { DataTableRegion } from "../components/ui/data-table-region";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { TextField } from "../components/ui/field";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useCreateModelProfileMutation,
  useModelBindingReadinessQuery,
  useModelProfilesListQuery,
  useModelProviderConnectionsListQuery,
} from "../hooks/use-models";
import {
  describeModelsWriteRoleRequirement,
  formatModelProviderLabel,
} from "../lib/model-resource-presentation";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";

export function ModelsPage() {
  const workspaceId = useWorkspaceQueryScope();
  const authQuery = useAuthContextQuery();
  const profilesQuery = useModelProfilesListQuery();
  const connectionsQuery = useModelProviderConnectionsListQuery();
  const readinessQuery = useModelBindingReadinessQuery();
  const createProfileMutation = useCreateModelProfileMutation();
  const [profileKey, setProfileKey] = useState("");
  const [profileName, setProfileName] = useState("");
  const [createMessage, setCreateMessage] = useState<string | undefined>();
  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  const workspaceReady = workspaceId !== undefined;
  const initialLoading =
    workspaceReady &&
    (profilesQuery.isPending || connectionsQuery.isPending) &&
    profilesQuery.data === undefined &&
    connectionsQuery.data === undefined;

  const connectionCount = connectionsQuery.data?.connections.length ?? 0;
  const profileCount = profilesQuery.data?.modelProfiles.length ?? 0;
  const hasBoundVersion = readinessQuery.data?.hasBoundProfileVersion === true;

  function refreshAll(): void {
    void profilesQuery.refetch();
    void connectionsQuery.refetch();
    void readinessQuery.refetch();
  }

  if (!workspaceReady) {
    return <LoadingBlock label="Select a workspace to manage models." />;
  }

  return (
    <div
      className="models-v2 page-stack activity-v2"
      data-testid="models-v2-page"
    >
      <PageHeader
        title="Models"
        subtitle="Model profiles for agents · provider connections for credentials and endpoints."
        actions={
          <>
            {profilesQuery.isFetching || connectionsQuery.isFetching ? (
              <span className="muted activity-v2-refresh-hint" role="status">
                Refreshing…
              </span>
            ) : null}
            <button
              type="button"
              className="button"
              onClick={refreshAll}
              disabled={profilesQuery.isFetching && connectionsQuery.isFetching}
            >
              Refresh
            </button>
          </>
        }
      />

      <ModelsSectionNav active="profiles" />
      <ModelsConceptsPanel />

      {!canWrite ? (
        <section className="activity-v2-degraded" role="status">
          <p className="activity-v2-degraded-title">Read-only access</p>
          <p className="muted">{describeModelsWriteRoleRequirement()}</p>
        </section>
      ) : null}

      {connectionCount === 0 && !connectionsQuery.isPending ? (
        <SectionPanel
          title="Start with a provider connection"
          description="Agents need a ModelProfileVersion that references a connection version before they can publish."
        >
          {canWrite ? (
            <LinkButton variant="primary" to="/models/connections">
              Create provider connection
            </LinkButton>
          ) : (
            <p className="muted">{describeModelsWriteRoleRequirement()}</p>
          )}
        </SectionPanel>
      ) : null}

      {connectionCount > 0 ? (
        <SectionPanel
          title="Provider connections"
          description="Credentials and endpoints live here — separate from model profiles."
          actions={
            <LinkButton variant="secondary" to="/models/connections">
              Manage connections ({connectionCount})
            </LinkButton>
          }
        >
          <ul className="models-v2-summary-list">
            {connectionsQuery.data?.connections.map((connection) => (
              <li key={connection.id}>
                <Link to={`/models/connections/${connection.id}`}>
                  {connection.name}
                </Link>
                <span className="muted">
                  {formatModelProviderLabel(connection.provider)} ·{" "}
                  <span className="mono">{connection.key}</span>
                </span>
              </li>
            ))}
          </ul>
          {!hasBoundVersion && profileCount > 0 ? (
            <p className="muted models-v2-hint" role="status">
              You have profiles but no version bound to a connection yet. Append
              a profile version with a connection version to enable Agent Studio
              publishing.
            </p>
          ) : null}
        </SectionPanel>
      ) : null}

      {initialLoading ? <LoadingBlock label="Loading models…" /> : null}
      {profilesQuery.isError ? (
        <ErrorState
          title="Failed to load model profiles"
          error={profilesQuery.error}
        />
      ) : null}
      {connectionsQuery.isError ? (
        <ErrorState
          title="Failed to load provider connections"
          error={connectionsQuery.error}
        />
      ) : null}

      {canWrite ? (
        <SectionPanel
          title="Create model profile"
          description="Keys must be unique in this workspace."
          className="models-v2-create-panel"
        >
          <div className="filters models-v2-filters">
            <TextField
              id="model-profile-key"
              label="Key"
              required
              value={profileKey}
              onChange={(event) => {
                setProfileKey(event.target.value);
                setCreateMessage(undefined);
              }}
            />
            <TextField
              id="model-profile-name"
              label="Name"
              required
              value={profileName}
              onChange={(event) => {
                setProfileName(event.target.value);
                setCreateMessage(undefined);
              }}
            />
          </div>
          {createMessage !== undefined ? (
            <p className="models-v2-success" role="status">
              {createMessage}
            </p>
          ) : null}
          <Button
            type="button"
            variant="primary"
            loading={createProfileMutation.isPending}
            disabled={
              profileKey.trim().length === 0 || profileName.trim().length === 0
            }
            onClick={() =>
              void createProfileMutation
                .mutateAsync({
                  key: profileKey.trim(),
                  name: profileName.trim(),
                })
                .then((created) => {
                  setProfileKey("");
                  setProfileName("");
                  setCreateMessage(`Created profile “${created.name}”.`);
                  void readinessQuery.refetch();
                })
                .catch(() => {
                  setCreateMessage(undefined);
                })
            }
          >
            Create profile
          </Button>
        </SectionPanel>
      ) : null}

      {profilesQuery.data !== undefined ? (
        <SectionPanel
          title="Model profiles"
          description="Each profile accumulates immutable versions agents can bind."
        >
          {profilesQuery.data.modelProfiles.length === 0 ? (
            <EmptyState
              title="No model profiles yet"
              description="Create a profile, then append a version on the profile detail page."
              action={
                canWrite ? (
                  <p className="muted">
                    Use the form above to add your first profile.
                  </p>
                ) : undefined
              }
            />
          ) : (
            <DataTableRegion caption="Model profiles">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Key</th>
                  <th scope="col">Profile ID</th>
                </tr>
              </thead>
              <tbody>
                {profilesQuery.data.modelProfiles.map((profile) => (
                  <tr key={profile.id}>
                    <td>
                      <Link to={`/models/${profile.id}`}>{profile.name}</Link>
                    </td>
                    <td className="mono">{profile.key}</td>
                    <td className="mono">
                      <details className="models-v2-tech-details">
                        <summary>Show ID</summary>
                        {profile.id}
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTableRegion>
          )}
        </SectionPanel>
      ) : null}
    </div>
  );
}
