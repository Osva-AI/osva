import { useState } from "react";
import { Link } from "react-router-dom";

import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useCreateModelProfileMutation,
  useModelProfilesListQuery,
  useModelProviderConnectionsListQuery,
} from "../hooks/use-models";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

export function ModelsPage() {
  const authQuery = useAuthContextQuery();
  const profilesQuery = useModelProfilesListQuery();
  const connectionsQuery = useModelProviderConnectionsListQuery();
  const createProfileMutation = useCreateModelProfileMutation();
  const [profileKey, setProfileKey] = useState("");
  const [profileName, setProfileName] = useState("");
  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Models</h1>
          <p className="page-subtitle">
            Model profiles and provider connections for the authenticated
            workspace. Connection credentials are configured externally; the
            Console never displays secret-reference names.
          </p>
        </div>
        <div className="toolbar">
          {canWrite ? (
            <Link className="button primary" to="/models/connections">
              Manage connections
            </Link>
          ) : null}
          <button
            type="button"
            className="button"
            onClick={() => {
              void profilesQuery.refetch();
              void connectionsQuery.refetch();
            }}
          >
            Refresh
          </button>
        </div>
      </header>

      {profilesQuery.isLoading || connectionsQuery.isLoading ? (
        <LoadingBlock label="Loading models…" />
      ) : null}
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
        <section className="panel">
          <h2 className="section-title">Create model profile</h2>
          <div className="filters">
            <div className="field">
              <label htmlFor="model-profile-key">Key</label>
              <input
                id="model-profile-key"
                value={profileKey}
                onChange={(event) => setProfileKey(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="model-profile-name">Name</label>
              <input
                id="model-profile-name"
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
              />
            </div>
          </div>
          <button
            type="button"
            className="button primary"
            disabled={
              createProfileMutation.isPending ||
              profileKey.trim().length === 0 ||
              profileName.trim().length === 0
            }
            onClick={() =>
              void createProfileMutation
                .mutateAsync({
                  key: profileKey.trim(),
                  name: profileName.trim(),
                })
                .then(() => {
                  setProfileKey("");
                  setProfileName("");
                })
            }
          >
            Create profile
          </button>
        </section>
      ) : null}

      {profilesQuery.data !== undefined ? (
        <section className="panel">
          <h2 className="section-title">Model profiles</h2>
          {profilesQuery.data.modelProfiles.length === 0 ? (
            <EmptyState
              title="No model profiles yet."
              description="Create a ModelProfile above, then append an immutable ModelProfileVersion on the profile detail page."
            />
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Key</th>
                    <th>Profile ID</th>
                  </tr>
                </thead>
                <tbody>
                  {profilesQuery.data.modelProfiles.map((profile) => (
                    <tr key={profile.id}>
                      <td>
                        <Link to={`/models/${profile.id}`}>{profile.name}</Link>
                      </td>
                      <td className="mono">{profile.key}</td>
                      <td className="mono">{profile.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {connectionsQuery.data !== undefined ? (
        <section className="panel">
          <h2 className="section-title">Provider connections</h2>
          {connectionsQuery.data.connections.length === 0 ? (
            <p className="muted">No provider connections configured.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Provider</th>
                    <th>Key</th>
                  </tr>
                </thead>
                <tbody>
                  {connectionsQuery.data.connections.map((connection) => (
                    <tr key={connection.id}>
                      <td>
                        <Link to={`/models/connections/${connection.id}`}>
                          {connection.name}
                        </Link>
                      </td>
                      <td>{connection.provider}</td>
                      <td className="mono">{connection.key}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
