import type { HomePageData } from "../../hooks/use-home-page-data";
import { HomePartialErrors } from "./home-partial-errors";
import { HomeV2AdvancedEntry } from "./home-v2-advanced-entry";
import { HomeV2ExplorationCards } from "./home-v2-exploration-cards";
import { HomeV2GuidedFoot } from "./home-v2-guided-foot";
import { HomeV2NewHero } from "./home-v2-new-hero";

export function HomeNewPresentation({ data }: { readonly data: HomePageData }) {
  return (
    <div className="home-v2 home-v2-new">
      <HomePartialErrors messages={data.partialErrors} />
      <HomeV2NewHero canWrite={data.canWrite} />
      <HomeV2ExplorationCards />
      <HomeV2GuidedFoot />
      <HomeV2AdvancedEntry
        preference={data.preference}
        onPreferenceChange={data.setPreference}
      />
    </div>
  );
}
