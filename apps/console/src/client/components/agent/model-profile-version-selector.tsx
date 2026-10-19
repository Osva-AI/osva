import { useState } from "react";

import {
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
  const [profileId, setProfileId] = useState("");
  const versionsQuery = useModelProfileVersionsQuery(
    profileId.length > 0 ? profileId : undefined,
  );

  const options =
    versionsQuery.data?.versions.map((version) => ({
      id: version.id,
      label: `${version.provider} / ${version.model} (v${String(version.version)})`,
    })) ?? [];

  return (
    <div className="filters">
      <div className="field">
        <label htmlFor="agent-model-profile">Model profile</label>
        <select
          id="agent-model-profile"
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
          <option value="">Select version…</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
