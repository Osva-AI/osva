import type { HomePresentationPreference } from "../../lib/home-presentation-preference";

export function HomePresentationSwitch({
  preference,
  onPreferenceChange,
}: {
  readonly preference: HomePresentationPreference;
  readonly onPreferenceChange: (preference: HomePresentationPreference) => void;
}) {
  return (
    <div
      className="home-presentation-switch"
      role="group"
      aria-label="Home presentation"
    >
      <button
        type="button"
        className={
          preference === "standard"
            ? "button home-presentation-option home-presentation-option-active"
            : "button button-secondary home-presentation-option"
        }
        aria-pressed={preference === "standard"}
        onClick={() => {
          onPreferenceChange("standard");
        }}
      >
        Standard
      </button>
      <button
        type="button"
        className={
          preference === "advanced"
            ? "button home-presentation-option home-presentation-option-active"
            : "button button-secondary home-presentation-option"
        }
        aria-pressed={preference === "advanced"}
        onClick={() => {
          onPreferenceChange("advanced");
        }}
      >
        Advanced
      </button>
    </div>
  );
}
