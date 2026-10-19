import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useAppendModelProfileVersionMutation,
  useModelProfileVersionsQuery,
  useModelProfilesListQuery,
} from "../hooks/use-models";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

export function ModelProfileDetailPage() {
  const { modelProfileId } = useParams<{ modelProfileId: string }>();
  const authQuery = useAuthContextQuery();
  const profilesQuery = useModelProfilesListQuery();
  const versionsQuery = useModelProfileVersionsQuery(modelProfileId);
  const appendMutation = useAppendModelProfileVersionMutation(
    modelProfileId ?? "",
  );
  const [provider, setProvider] = useState("OPENAI");
  const [model, setModel] = useState("");
  const [connectionVersionId, setConnectionVersionId] = useState("");

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  if (modelProfileId === undefined) {
    return (
      <ErrorState
        title="Invalid route"
        error={new Error("Missing modelProfileId.")}
      />
    );
  }

  const profile = profilesQuery.data?.modelProfiles.find(
    (item) => item.id === modelProfileId,
  );

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">{profile?.name ?? "Model profile"}</h1>
          <p className="page-subtitle mono">{modelProfileId}</p>
        </div>
        <Link className="button" to="/models">
          Back
        </Link>
      </header>

      {canWrite ? (
        <section className="panel">
          <h2 className="section-title">Append ModelProfileVersion</h2>
          <p className="muted">
            Bind a provider model id to an optional
            ModelProviderConnectionVersion from a provider connection detail
            page.
          </p>
          <div className="filters">
            <div className="field">
              <label htmlFor="model-profile-provider">Provider</label>
              <select
                id="model-profile-provider"
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
              >
                <option value="OPENAI">OPENAI</option>
                <option value="ANTHROPIC">ANTHROPIC</option>
                <option value="GOOGLE_GEMINI">GOOGLE_GEMINI</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="model-profile-model">Model identifier</label>
              <input
                id="model-profile-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="gpt-4o"
              />
            </div>
            <div className="field">
              <label htmlFor="model-profile-connection-version">
                Connection version ID (optional)
              </label>
              <input
                id="model-profile-connection-version"
                value={connectionVersionId}
                onChange={(event) => setConnectionVersionId(event.target.value)}
                className="mono"
                spellCheck={false}
              />
            </div>
          </div>
          <button
            type="button"
            className="button primary"
            disabled={appendMutation.isPending || model.trim().length === 0}
            onClick={() =>
              void appendMutation
                .mutateAsync({
                  provider,
                  model: model.trim(),
                  ...(connectionVersionId.trim().length > 0
                    ? {
                        modelProviderConnectionVersionId:
                          connectionVersionId.trim(),
                      }
                    : {}),
                })
                .then(() => {
                  setModel("");
                  setConnectionVersionId("");
                  void versionsQuery.refetch();
                })
            }
          >
            Append version
          </button>
        </section>
      ) : null}

      {versionsQuery.isLoading ? (
        <LoadingBlock label="Loading versions…" />
      ) : null}
      {versionsQuery.data !== undefined ? (
        <section className="panel">
          <h2 className="section-title">Immutable versions</h2>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>Connection version</th>
                  <th>Version ID</th>
                </tr>
              </thead>
              <tbody>
                {versionsQuery.data.versions.map((version) => (
                  <tr key={version.id}>
                    <td>{version.version}</td>
                    <td>{version.provider}</td>
                    <td className="mono">{version.model}</td>
                    <td className="mono">
                      {version.modelProviderConnectionVersionId ?? "—"}
                    </td>
                    <td className="mono">{version.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
