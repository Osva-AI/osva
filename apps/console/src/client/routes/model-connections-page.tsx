import { Link } from "react-router-dom";
import { useState } from "react";

import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { Button, LinkButton } from "../components/ui/button";
import { DataTableRegion } from "../components/ui/data-table-region";
import { SelectField, TextField } from "../components/ui/field";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useCreateModelProviderConnectionMutation,
  useModelProviderConnectionsListQuery,
} from "../hooks/use-models";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

export function ModelConnectionsPage() {
  const authQuery = useAuthContextQuery();
  const connectionsQuery = useModelProviderConnectionsListQuery();
  const createMutation = useCreateModelProviderConnectionMutation();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("OPENAI");
  const [formError, setFormError] = useState<string | undefined>();
  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  return (
    <>
      <PageHeader
        title="Provider connections"
        subtitle="Workspace-owned provider connections with immutable versions."
        actions={
          <LinkButton variant="secondary" to="/models">
            Back to models
          </LinkButton>
        }
      />

      {connectionsQuery.isLoading ? (
        <LoadingBlock label="Loading connections…" />
      ) : null}
      {connectionsQuery.isError ? (
        <ErrorState
          title="Failed to load connections"
          error={connectionsQuery.error}
        />
      ) : null}

      {canWrite ? (
        <SectionPanel
          title="Create connection"
          description="Keys must be unique within the workspace. Secrets are stored as references, not shown here."
        >
          <div className="filters">
            <TextField
              id="connection-key"
              label="Key"
              required
              value={key}
              onChange={(event) => {
                setKey(event.target.value);
                setFormError(undefined);
              }}
              error={
                formError !== undefined && key.trim().length === 0
                  ? formError
                  : undefined
              }
            />
            <TextField
              id="connection-name"
              label="Name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <SelectField
              id="connection-provider"
              label="Provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            >
              <option value="OPENAI">OPENAI</option>
              <option value="ANTHROPIC">ANTHROPIC</option>
              <option value="GOOGLE_GEMINI">GOOGLE_GEMINI</option>
            </SelectField>
          </div>
          <Button
            type="button"
            variant="primary"
            loading={createMutation.isPending}
            disabled={key.trim().length === 0 || name.trim().length === 0}
            onClick={() => {
              if (key.trim().length === 0) {
                setFormError("Key is required.");
                return;
              }
              void createMutation.mutateAsync({ key, name, provider });
            }}
          >
            Create connection
          </Button>
        </SectionPanel>
      ) : null}

      {connectionsQuery.data !== undefined ? (
        <SectionPanel title="Connections">
          <DataTableRegion caption="Model provider connections">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Provider</th>
                <th scope="col">Key</th>
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
          </DataTableRegion>
        </SectionPanel>
      ) : null}
    </>
  );
}
