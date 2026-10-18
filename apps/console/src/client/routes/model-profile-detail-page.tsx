import { Link, useParams } from "react-router-dom";

import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import {
  useModelProfileVersionsQuery,
  useModelProfilesListQuery,
} from "../hooks/use-models";

export function ModelProfileDetailPage() {
  const { modelProfileId } = useParams<{ modelProfileId: string }>();
  const profilesQuery = useModelProfilesListQuery();
  const versionsQuery = useModelProfileVersionsQuery(modelProfileId);

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
