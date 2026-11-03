import type { HomePresentationPreference } from "../../lib/home-presentation-preference";

export function HomeV2AdvancedEntry({
  preference,
  onPreferenceChange,
}: {
  readonly preference: HomePresentationPreference;
  readonly onPreferenceChange: (preference: HomePresentationPreference) => void;
}) {
  if (preference === "advanced") {
    return (
      <p className="home-v2-advanced-entry muted">
        <button
          type="button"
          className="button-link"
          onClick={() => {
            onPreferenceChange("standard");
          }}
        >
          Return to standard Home
        </button>
      </p>
    );
  }

  return (
    <p className="home-v2-advanced-entry muted">
      Need registry counts and run summaries?{" "}
      <button
        type="button"
        className="button-link"
        onClick={() => {
          onPreferenceChange("advanced");
        }}
      >
        Open advanced dashboard
      </button>
    </p>
  );
}
