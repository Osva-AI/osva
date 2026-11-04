import { useState } from "react";
import { useParams } from "react-router-dom";

import { ModelsSectionNav } from "../components/models/models-section-nav";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { OperatorGuidancePanel } from "../components/operator/operator-guidance";
import { Button, LinkButton } from "../components/ui/button";
import { DataTableRegion } from "../components/ui/data-table-region";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { TextField } from "../components/ui/field";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useAppendModelProviderConnectionVersionMutation,
  useModelProviderConnectionVersionsQuery,
  useModelProviderConnectionsListQuery,
  useTestModelProviderConnectionVersionMutation,
} from "../hooks/use-models";
import { ConsoleApiError } from "../lib/console-api";
import type { OperatorGuidance } from "../lib/operator-diagnostics";
import {
  describeConsoleApiError,
  describeModelConnectivityResult,
} from "../lib/operator-diagnostics";
import {
  describeModelsExecuteRoleRequirement,
  describeModelsWriteRoleRequirement,
  formatConnectionCredentialStatus,
  formatConnectionEndpointSummary,
  formatModelProviderLabel,
} from "../lib/model-resource-presentation";
import {
  roleCanExecuteControlPlaneActions,
  roleCanWriteControlPlaneResources,
} from "../lib/permissions";

export function ModelConnectionDetailPage() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const authQuery = useAuthContextQuery();
  const connectionsQuery = useModelProviderConnectionsListQuery();
  const versionsQuery = useModelProviderConnectionVersionsQuery(connectionId);
  const appendMutation = useAppendModelProviderConnectionVersionMutation(
    connectionId ?? "",
  );
  const [baseUrl, setBaseUrl] = useState("");
  const [allowPrivate, setAllowPrivate] = useState(false);
  const [credentialKey, setCredentialKey] = useState("");
  const [testModel, setTestModel] = useState("");
  const [connectivityGuidance, setConnectivityGuidance] = useState<
    OperatorGuidance | undefined
  >();
  const [appendMessage, setAppendMessage] = useState<string | undefined>();

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

  if (connectionsQuery.isError) {
    return (
      <ErrorState
        title="Failed to load connection"
        error={connectionsQuery.error}
      />
    );
  }

  if (versionsQuery.isError) {
    return (
      <ErrorState
        title="Failed to load connection versions"
        error={versionsQuery.error}
      />
    );
  }

  return (
    <div
      className="models-v2 page-stack activity-v2"
      data-testid="models-connection-detail-page"
    >
      <PageHeader
        title={connection?.name ?? "Provider connection"}
        subtitle={
          connection !== undefined
            ? `${formatModelProviderLabel(connection.provider)} · key ${connection.key}`
            : "Connection detail"
        }
        actions={
          <LinkButton variant="secondary" to="/models/connections">
            Back to connections
          </LinkButton>
        }
      />

      <ModelsSectionNav active="connections" />

      <details className="models-v2-tech-details">
        <summary>Technical identifiers</summary>
        <dl className="meta-list">
          <div>
            <dt>Connection ID</dt>
            <dd className="mono">{connectionId}</dd>
          </div>
          {connection !== undefined ? (
            <div>
              <dt>Provider</dt>
              <dd>{formatModelProviderLabel(connection.provider)}</dd>
            </div>
          ) : null}
        </dl>
      </details>

      {!canWrite ? (
        <section className="activity-v2-degraded" role="status">
          <p className="activity-v2-degraded-title">Read-only access</p>
          <p className="muted">{describeModelsWriteRoleRequirement()}</p>
        </section>
      ) : null}

      {canWrite ? (
        <SectionPanel
          title="Append connection version"
          description="Enter a new external secret reference only when rotating credentials. Existing reference names are never shown."
        >
          <div className="filters models-v2-filters">
            <TextField
              id="connection-endpoint"
              label="Endpoint base URL"
              hint="OpenAI-compatible base URL. Leave empty to use the provider default."
              value={baseUrl}
              onChange={(event) => {
                setBaseUrl(event.target.value);
                setAppendMessage(undefined);
              }}
              placeholder="https://litellm.example.com/v1"
            />
            <TextField
              id="connection-credential"
              label="Secret reference key"
              optional
              value={credentialKey}
              onChange={(event) => setCredentialKey(event.target.value)}
              placeholder="OPENAI_API_KEY"
              autoComplete="off"
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={allowPrivate}
                onChange={(event) => setAllowPrivate(event.target.checked)}
              />
              Allow private/loopback networks for this endpoint
            </label>
          </div>
          {appendMessage !== undefined ? (
            <p className="models-v2-success" role="status">
              {appendMessage}
            </p>
          ) : null}
          <Button
            type="button"
            variant="primary"
            loading={appendMutation.isPending}
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
                .then((created) => {
                  setBaseUrl("");
                  setCredentialKey("");
                  setAppendMessage(
                    `Appended connection version ${String(created.version)}.`,
                  );
                  void versionsQuery.refetch();
                })
                .catch(() => {
                  setAppendMessage(undefined);
                })
            }
          >
            Append version
          </Button>
        </SectionPanel>
      ) : null}

      {versionsQuery.data !== undefined ? (
        <SectionPanel
          title="Immutable versions"
          description="Model profile versions bind to one of these ids."
        >
          {canExecute ? (
            <TextField
              id="connection-test-model"
              label="Connectivity test model identifier"
              hint="Tests call generateText once. Use the same model id as your ModelProfileVersion."
              value={testModel}
              onChange={(event) => setTestModel(event.target.value)}
              placeholder="Model id from a ModelProfileVersion (e.g. gpt-4o)"
            />
          ) : (
            <p className="muted" role="status">
              {describeModelsExecuteRoleRequirement()}
            </p>
          )}
          {versionsQuery.data.versions.length === 0 ? (
            <p className="muted" role="status">
              No versions yet. Append endpoint and credential references above.
            </p>
          ) : (
            <DataTableRegion caption="Connection versions">
              <thead>
                <tr>
                  <th scope="col">Version</th>
                  <th scope="col">Endpoint</th>
                  <th scope="col">Credential</th>
                  <th scope="col">Actions</th>
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
                    onTestGuidance={setConnectivityGuidance}
                  />
                ))}
              </tbody>
            </DataTableRegion>
          )}
          {connectivityGuidance !== undefined ? (
            <OperatorGuidancePanel
              guidance={connectivityGuidance}
              testId="model-connectivity-guidance"
            />
          ) : null}
        </SectionPanel>
      ) : null}
    </div>
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
  readonly onTestGuidance: (value: OperatorGuidance | undefined) => void;
}) {
  const testMutation = useTestModelProviderConnectionVersionMutation(
    props.connectionId,
    props.version.id,
  );

  return (
    <tr>
      <td>
        <span>{props.version.version}</span>
        <details className="models-v2-tech-details">
          <summary className="mono">Version ID</summary>
          <span className="mono">{props.version.id}</span>
        </details>
      </td>
      <td className="mono">{formatConnectionEndpointSummary(props.version)}</td>
      <td>{formatConnectionCredentialStatus(props.version)}</td>
      <td>
        {props.canExecute ? (
          <Button
            type="button"
            variant="secondary"
            loading={testMutation.isPending}
            disabled={props.testModel.trim().length === 0}
            onClick={() => {
              props.onTestGuidance(undefined);
              void testMutation
                .mutateAsync({ model: props.testModel.trim() })
                .then((result) => {
                  props.onTestGuidance(
                    describeModelConnectivityResult({
                      status: result.status,
                      code: result.code,
                    }),
                  );
                })
                .catch((error: unknown) => {
                  const guidance =
                    describeConsoleApiError(error, "model_connectivity") ??
                    (error instanceof ConsoleApiError
                      ? {
                          title: "Connectivity test failed",
                          explanation: error.message,
                          nextSteps: [
                            "Verify connection version endpoint and credential references.",
                          ],
                          severity: "error" as const,
                          recoverable: true,
                        }
                      : {
                          title: "Connectivity test failed",
                          explanation:
                            error instanceof Error
                              ? error.message
                              : "Unexpected error.",
                          nextSteps: ["Retry the connectivity test."],
                          severity: "error" as const,
                          recoverable: true,
                        });
                  props.onTestGuidance(guidance);
                });
            }}
          >
            Test
          </Button>
        ) : null}
      </td>
    </tr>
  );
}
