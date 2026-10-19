import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useAppendModelProviderConnectionVersionMutation,
  useModelProviderConnectionsListQuery,
  useTestModelProviderConnectionVersionMutation,
} from "../hooks/use-models";
import { consoleFetch } from "../lib/console-api";
import {
  roleCanExecuteControlPlaneActions,
  roleCanWriteControlPlaneResources,
} from "../lib/permissions";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";

export function ModelConnectionDetailPage() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const authQuery = useAuthContextQuery();
  const connectionsQuery = useModelProviderConnectionsListQuery();
  const workspaceId = useWorkspaceQueryScope();
  const versionsQuery = useQuery({
    queryKey: [
      "model-provider-connections",
      workspaceId,
      connectionId,
      "versions",
    ],
    enabled: workspaceId !== undefined && connectionId !== undefined,
    queryFn: () =>
      consoleFetch<{
        versions: Array<{
          id: string;
          version: number;
          provider: string;
          endpoint?: { baseUrl: string };
          credential?: { configured: true };
          createdAt: string;
        }>;
      }>(
        `/api/v1/model-provider-connections/${encodeURIComponent(connectionId ?? "")}/versions`,
      ),
  });
  const appendMutation = useAppendModelProviderConnectionVersionMutation(
    connectionId ?? "",
  );
  const [baseUrl, setBaseUrl] = useState("");
  const [allowPrivate, setAllowPrivate] = useState(false);
  const [credentialKey, setCredentialKey] = useState("");
  const [testModel, setTestModel] = useState("");
  const [testResult, setTestResult] = useState<string | undefined>();

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);
  const canExecute =
    authQuery.data !== undefined &&
    roleCanExecuteControlPlaneActions(authQuery.data.role);

  const connection = connectionsQuery.data?.connections.find(
    (item) => item.id === connectionId,
  );

  if (connectionId === undefined) {
    return (
      <ErrorState
        title="Invalid route"
        error={new Error("Missing connectionId.")}
      />
    );
  }

  if (connectionsQuery.isLoading || versionsQuery.isLoading) {
    return <LoadingBlock label="Loading connection…" />;
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">{connection?.name ?? "Connection"}</h1>
          <p className="page-subtitle mono">{connectionId}</p>
        </div>
        <Link className="button" to="/models/connections">
          Back
        </Link>
      </header>

      {canWrite ? (
        <section className="panel">
          <h2 className="section-title">Append connection version</h2>
          <p className="muted">
            Enter a new external secret reference name only when rotating
            credentials. Existing names are never shown.
          </p>
          <div className="filters">
            <div className="field">
              <label htmlFor="connection-endpoint">
                Endpoint base URL (OpenAI-compatible)
              </label>
              <input
                id="connection-endpoint"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://litellm.example.com/v1"
              />
            </div>
            <div className="field">
              <label htmlFor="connection-credential">
                Secret reference key (optional)
              </label>
              <input
                id="connection-credential"
                value={credentialKey}
                onChange={(event) => setCredentialKey(event.target.value)}
                placeholder="OPENAI_API_KEY"
                autoComplete="off"
              />
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={allowPrivate}
                onChange={(event) => setAllowPrivate(event.target.checked)}
              />
              Allow private/loopback networks for this endpoint
            </label>
          </div>
          <button
            type="button"
            className="button primary"
            disabled={appendMutation.isPending}
            onClick={() =>
              void appendMutation
                .mutateAsync({
                  ...(baseUrl.trim().length > 0
                    ? {
                        endpoint: {
                          baseUrl: baseUrl.trim(),
                          allowPrivateNetworks: allowPrivate,
                        },
                      }
                    : {}),
                  ...(credentialKey.trim().length > 0
                    ? { credentialRef: { key: credentialKey.trim() } }
                    : {}),
                })
                .then(() => versionsQuery.refetch())
            }
          >
            Append version
          </button>
        </section>
      ) : null}

      {versionsQuery.data !== undefined ? (
        <section className="panel">
          <h2 className="section-title">Versions</h2>
          {canExecute ? (
            <div className="field">
              <label htmlFor="connection-test-model">
                Connectivity test model identifier
              </label>
              <input
                id="connection-test-model"
                value={testModel}
                onChange={(event) => setTestModel(event.target.value)}
                placeholder="Model id from a ModelProfileVersion (e.g. gpt-4o)"
              />
              <p className="muted">
                Tests call generateText once with this model; use the same id as
                your ModelProfileVersion when binding this connection.
              </p>
            </div>
          ) : null}
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Endpoint</th>
                  <th>Credential</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {versionsQuery.data.versions.map((version) => (
                  <VersionRow
                    key={version.id}
                    connectionId={connectionId}
                    version={version}
                    canExecute={canExecute}
                    testModel={testModel}
                    onTestResult={setTestResult}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {testResult !== undefined ? (
            <p className="muted">Last connectivity test: {testResult}</p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function VersionRow(props: {
  readonly connectionId: string;
  readonly version: {
    readonly id: string;
    readonly version: number;
    readonly endpoint?: { readonly baseUrl: string };
    readonly credential?: { readonly configured: true };
  };
  readonly canExecute: boolean;
  readonly testModel: string;
  readonly onTestResult: (value: string) => void;
}) {
  const testMutation = useTestModelProviderConnectionVersionMutation(
    props.connectionId,
    props.version.id,
  );

  return (
    <tr>
      <td>{props.version.version}</td>
      <td className="mono">{props.version.endpoint?.baseUrl ?? "—"}</td>
      <td>
        {props.version.credential?.configured === true ? "Configured" : "—"}
      </td>
      <td>
        {props.canExecute ? (
          <button
            type="button"
            className="button"
            disabled={
              testMutation.isPending || props.testModel.trim().length === 0
            }
            onClick={() =>
              void testMutation
                .mutateAsync({ model: props.testModel.trim() })
                .then((result) => {
                  props.onTestResult(`${result.status} @ ${result.checkedAt}`);
                })
            }
          >
            Test
          </button>
        ) : null}
      </td>
    </tr>
  );
}
