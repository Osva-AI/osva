import { InlineMessage } from "../ui/inline-message";
import { HomePartialErrors } from "./home-partial-errors";
import { HomePresentationSwitch } from "./home-presentation-switch";
import type { HomePresentationPreference } from "../../lib/home-presentation-preference";

export function HomeDegradedPresentation({
  reason,
  partialErrors,
  preference,
  onPreferenceChange,
}: {
  readonly reason: string;
  readonly partialErrors: readonly string[];
  readonly preference: HomePresentationPreference;
  readonly onPreferenceChange: (preference: HomePresentationPreference) => void;
}) {
  return (
    <div className="home-stack">
      <InlineMessage tone="error" title="Home data is incomplete">
        {reason} Resources or runs may still exist—we could not confirm an empty
        workspace from the queries that succeeded.
      </InlineMessage>
      <HomePartialErrors messages={partialErrors} />
      <HomePresentationSwitch
        preference={preference}
        onPreferenceChange={onPreferenceChange}
      />
    </div>
  );
}
