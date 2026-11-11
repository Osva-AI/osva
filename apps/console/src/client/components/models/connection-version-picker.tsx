import { useEffect, useMemo, useState } from "react";

import { SelectField } from "../ui/field";
import {
  useModelProviderConnectionVersionsQuery,
  useModelProviderConnectionsListQuery,
} from "../../hooks/use-models";
import { workspaceScopedFetch } from "../../lib/console-api";
import { useWorkspaceQueryScope } from "../../hooks/use-workspace-query-scope";
import { summarizeConnectionVersionOption } from "../../lib/model-resource-presentation";

export function ConnectionVersionPicker(props: {
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (connectionVersionId: string) => void;
}) {
  const connectionsQuery = useModelProviderConnectionsListQuery();
  const workspaceId = useWorkspaceQueryScope();
  const [connectionId, setConnectionId] = useState("");
  const versionsQuery = useModelProviderConnectionVersionsQuery(
    connectionId.length > 0 ? connectionId : undefined,
  );

  const connections = connectionsQuery.data?.connections ?? [];

  const connectionNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const connection of connections) {
      map.set(connection.id, connection.name);
    }
    return map;
  }, [connections]);

  useEffect(() => {
    if (props.value.length === 0 || connectionId.length > 0) {
      return;
    }
    if (connections.length === 0 || workspaceId === undefined) {
      return;
    }
    let cancelled = false;
    void (async () => {
      for (const connection of connections) {
        const payload = await workspaceScopedFetch<{
          versions: Array<{ id: string }>;
        }>(
          workspaceId,
          `/api/v1/model-provider-connections/${encodeURIComponent(connection.id)}/versions`,
        );
        if (cancelled) {
          return;
        }
        if (payload.versions.some((version) => version.id === props.value)) {
          setConnectionId(connection.id);
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionId.length, connections, props.value]);

  const versionOptions = useMemo(() => {
    const name = connectionNameById.get(connectionId) ?? "Connection";
    return (versionsQuery.data?.versions ?? []).map((version) => ({
      id: version.id,
      label: summarizeConnectionVersionOption({
        connectionName: name,
        version,
      }),
    }));
  }, [connectionId, connectionNameById, versionsQuery.data?.versions]);

  return (
    <div className="models-v2-connection-picker stack">
      <SelectField
        id="model-profile-connection"
        label="Provider connection"
        hint="Choose where credentials and endpoint settings live."
        value={connectionId}
        disabled={props.disabled || connectionsQuery.isLoading}
        onChange={(event) => {
          setConnectionId(event.target.value);
          props.onChange("");
        }}
      >
        <option value="">Select connection…</option>
        {connections.map((connection) => (
          <option key={connection.id} value={connection.id}>
            {connection.name} ({connection.key})
          </option>
        ))}
      </SelectField>
      <SelectField
        id="model-profile-connection-version-select"
        label="Connection version"
        hint="Immutable version appended on the connection detail page."
        value={props.value}
        disabled={
          props.disabled ||
          connectionId.length === 0 ||
          versionOptions.length === 0
        }
        onChange={(event) => props.onChange(event.target.value)}
      >
        <option value="">Select version…</option>
        {versionOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </SelectField>
      {connectionId.length > 0 && versionOptions.length === 0 ? (
        <p className="muted" role="status">
          This connection has no versions yet. Append one on the connection
          detail page, then return here.
        </p>
      ) : null}
      <details className="models-v2-tech-details">
        <summary>Advanced: paste connection version ID</summary>
        <label
          className="visually-hidden"
          htmlFor="model-profile-connection-version"
        >
          Connection version ID
        </label>
        <input
          id="model-profile-connection-version"
          className="mono ui-control"
          value={props.value}
          spellCheck={false}
          disabled={props.disabled}
          onChange={(event) => props.onChange(event.target.value)}
        />
      </details>
    </div>
  );
}
