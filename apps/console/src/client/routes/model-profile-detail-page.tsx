import { useState } from "react";
import { useParams } from "react-router-dom";

import { ConnectionVersionPicker } from "../components/models/connection-version-picker";
import { ModelsSectionNav } from "../components/models/models-section-nav";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { Button, LinkButton } from "../components/ui/button";
import { DataTableRegion } from "../components/ui/data-table-region";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { SelectField, TextField } from "../components/ui/field";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useAppendModelProfileVersionMutation,
  useModelProfileVersionsQuery,
  useModelProfilesListQuery,
} from "../hooks/use-models";
import {
  describeModelsWriteRoleRequirement,
  formatModelProviderLabel,
} from "../lib/model-resource-presentation";
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
  const [appendMessage, setAppendMessage] = useState<string | undefined>();

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
    <div
      className="models-v2 page-stack activity-v2"
      data-testid="models-profile-detail-page"
    >
      <PageHeader
        title={profile?.name ?? "Model profile"}
        subtitle={
          profile !== undefined
            ? `Key ${profile.key} · append immutable versions agents bind in Studio.`
            : "Model profile detail"
        }
        actions={
          <LinkButton variant="secondary" to="/models">
            Back to profiles
          </LinkButton>
        }
      />

      <ModelsSectionNav active="profiles" />

      <details className="models-v2-tech-details">
        <summary>Technical identifiers</summary>
        <dl className="meta-list">
          <div>
            <dt>ModelProfile ID</dt>
            <dd className="mono">{modelProfileId}</dd>
          </div>
          {profile !== undefined ? (
            <div>
              <dt>Key</dt>
              <dd className="mono">{profile.key}</dd>
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
          title="Append model profile version"
          description="Each append is immutable. Bind a connection version so runs can reach your provider."
        >
          <div className="filters models-v2-filters">
            <SelectField
              id="model-profile-provider"
              label="Provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            >
              <option value="OPENAI">OpenAI</option>
              <option value="ANTHROPIC">Anthropic</option>
              <option value="GOOGLE_GEMINI">Google Gemini</option>
            </SelectField>
            <TextField
              id="model-profile-model"
              label="Model identifier"
              hint="Provider model id (for example gpt-4o)."
              required
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                setAppendMessage(undefined);
              }}
              placeholder="gpt-4o"
            />
          </div>
          <ConnectionVersionPicker
            value={connectionVersionId}
            onChange={(next) => {
              setConnectionVersionId(next);
              setAppendMessage(undefined);
            }}
          />
          {appendMessage !== undefined ? (
            <p className="models-v2-success" role="status">
              {appendMessage}
            </p>
          ) : null}
          <Button
            type="button"
            variant="primary"
            loading={appendMutation.isPending}
            disabled={model.trim().length === 0}
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
                .then((created) => {
                  setModel("");
                  setConnectionVersionId("");
                  setAppendMessage(
                    `Appended version ${String(created.version)} (${formatModelProviderLabel(created.provider)} / ${created.model}).`,
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

      {versionsQuery.isLoading ? (
        <LoadingBlock label="Loading versions…" />
      ) : null}
      {versionsQuery.isError ? (
        <ErrorState
          title="Failed to load profile versions"
          error={versionsQuery.error}
        />
      ) : null}
      {versionsQuery.data !== undefined ? (
        <SectionPanel
          title="Immutable versions"
          description="Agent Studio binds one of these ids when you publish."
        >
          {versionsQuery.data.versions.length === 0 ? (
            <p className="muted" role="status">
              No versions yet. Append one above to make this profile usable in
              agents.
            </p>
          ) : (
            <DataTableRegion caption="Model profile versions">
              <thead>
                <tr>
                  <th scope="col">Version</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Model</th>
                  <th scope="col">Connection</th>
                  <th scope="col">Version ID</th>
                </tr>
              </thead>
              <tbody>
                {versionsQuery.data.versions.map((version) => (
                  <tr key={version.id}>
                    <td>{version.version}</td>
                    <td>{formatModelProviderLabel(version.provider)}</td>
                    <td className="mono">{version.model}</td>
                    <td>
                      {version.modelProviderConnectionVersionId !== undefined &&
                      version.modelProviderConnectionVersionId.length > 0 ? (
                        <details className="models-v2-tech-details">
                          <summary>Bound</summary>
                          <span className="mono">
                            {version.modelProviderConnectionVersionId}
                          </span>
                        </details>
                      ) : (
                        <span className="muted">Not bound</span>
                      )}
                    </td>
                    <td>
                      <details className="models-v2-tech-details">
                        <summary className="mono">{version.id}</summary>
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
