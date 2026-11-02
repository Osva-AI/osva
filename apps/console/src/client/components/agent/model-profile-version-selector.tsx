import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  useModelBindingReadinessQuery,
  useModelProfileVersionsQuery,
  useModelProfilesListQuery,
} from "../../hooks/use-models";

export interface ModelProfileVersionSelection {
  readonly modelProfileVersionId: string;
  readonly label: string;
}

export function ModelProfileVersionSelector(props: {
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (
    selection: ModelProfileVersionSelection | undefined,
  ) => void;
}) {
  const profilesQuery = useModelProfilesListQuery();
  const readinessQuery = useModelBindingReadinessQuery();
  const [profileId, setProfileId] = useState("");
  const versionsQuery = useModelProfileVersionsQuery(
    profileId.length > 0 ? profileId : undefined,
  );

  const resolvedSelection = useMemo(() => {
    if (props.value.length === 0) {
      return undefined;
    }
    for (const entry of readinessQuery.data?.profileVersions ?? []) {
      const match = entry.versions.find(
        (version) => version.id === props.value,
      );
      if (match !== undefined) {
        return {
          profileId: entry.profileId,
          label: `${match.provider} / ${match.model} (v${String(match.version)})`,
          version: match,
        };
      }
    }
    return undefined;
  }, [props.value, readinessQuery.data?.profileVersions]);

  useEffect(() => {
    if (
      resolvedSelection !== undefined &&
      profileId !== resolvedSelection.profileId
    ) {
      setProfileId(resolvedSelection.profileId);
    }
  }, [profileId, resolvedSelection]);

  const options =
    versionsQuery.data?.versions.map((version) => ({
      id: version.id,
      label: `${version.provider} / ${version.model} (v${String(version.version)})`,
      missingConnection:
        version.modelProviderConnectionVersionId === undefined ||
        version.modelProviderConnectionVersionId.length === 0,
    })) ?? [];

  const profilesEmpty =
    !profilesQuery.isLoading &&
    (profilesQuery.data?.modelProfiles.length ?? 0) === 0;

  return (
    <div className="filters">
      {props.value.length > 0 && resolvedSelection === undefined ? (
        <p className="muted" role="status">
          Selected version <span className="mono">{props.value}</span> is not
          available in this workspace catalog. Choose a visible version or{" "}
          <Link to="/models/profiles">open Models</Link>.
        </p>
      ) : null}
      {resolvedSelection !== undefined ? (
        <p className="muted" role="status">
          Bound version:{" "}
          <span className="mono">{resolvedSelection.version.id}</span> —{" "}
          {resolvedSelection.label}
        </p>
      ) : null}
      {profilesEmpty ? (
        <p className="muted">
          No model profiles yet.{" "}
          <Link to="/models/connections">Create a connection</Link>, then{" "}
          <Link to="/models/profiles">publish a model profile version</Link>.
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="agent-model-profile">Model profile</label>
        <select
          id="agent-model-profile"
          className="ui-control"
          value={profileId}
          disabled={props.disabled || profilesQuery.isLoading}
          onChange={(event) => {
            setProfileId(event.target.value);
            props.onChange(undefined);
          }}
        >
          <option value="">Select profile…</option>
          {(profilesQuery.data?.modelProfiles ?? []).map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name} ({profile.key})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="agent-primary-model">Primary model version</label>
        <select
          id="agent-primary-model"
          className="ui-control"
          value={props.value}
          disabled={
            props.disabled || profileId.length === 0 || options.length === 0
          }
          onChange={(event) => {
            const option = options.find(
              (item) => item.id === event.target.value,
            );
            props.onChange(
              option === undefined
                ? undefined
                : {
                    modelProfileVersionId: option.id,
                    label: option.label,
                  },
            );
          }}
        >
          <option value="">Select immutable version…</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
              {option.missingConnection ? " — connection not configured" : ""}
            </option>
          ))}
        </select>
        {profileId.length > 0 && options.length === 0 ? (
          <p className="muted">
            This profile has no published versions yet.{" "}
            <Link to={`/models/profiles/${profileId}`}>Open profile</Link>.
          </p>
        ) : null}
      </div>
    </div>
  );
}
