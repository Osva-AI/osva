import type { HomePageData } from "../../hooks/use-home-page-data";
import {
  selectHomeSideContext,
  shouldUseReturningGrid,
} from "../../lib/home-v2-side-context";
import { selectHomeResumeTarget } from "../../lib/home-v2-resume";
import { HomePartialErrors } from "./home-partial-errors";
import { HomeV2AdvancedEntry } from "./home-v2-advanced-entry";
import { HomeV2Attention } from "./home-v2-attention";
import { HomeV2ContinueCard } from "./home-v2-continue-card";
import { HomeV2RecentActivity } from "./home-v2-recent-activity";
import { HomeV2ReturnHeader } from "./home-v2-return-header";
import { HomeV2SecondaryActions } from "./home-v2-secondary-actions";
import { HomeV2SidePanel } from "./home-v2-side-panel";

export function HomeActivePresentation({
  data,
}: {
  readonly data: HomePageData;
}) {
  const resume = selectHomeResumeTarget({
    agents: data.agents,
    workflows: data.workflows,
    recentRuns: data.recentRuns,
  });
  const side = selectHomeSideContext({
    resume,
    agents: data.agents,
    workflows: data.workflows,
    recentRuns: data.recentRuns,
    attentionItems: data.attentionItems,
  });
  const useGrid = shouldUseReturningGrid({ resume, side });
  const embeddedAttention = side.attentionItem;
  const remainingAttention = data.attentionItems.filter((item) => {
    if (embeddedAttention === undefined) {
      return true;
    }
    return !(
      item.id === embeddedAttention.id && item.kind === embeddedAttention.kind
    );
  });

  return (
    <div className="home-v2 home-v2-returning">
      <HomePartialErrors messages={data.partialErrors} />
      <HomeV2ReturnHeader canWrite={data.canWrite} />
      {resume !== undefined ? (
        <div
          className={useGrid ? "home-v2-return-grid" : "home-v2-return-stack"}
        >
          <HomeV2ContinueCard target={resume} />
          {useGrid ? <HomeV2SidePanel side={side} /> : null}
        </div>
      ) : null}
      {remainingAttention.length > 0 ? (
        <HomeV2Attention attentionItems={remainingAttention} />
      ) : null}
      <HomeV2RecentActivity data={data} />
      <HomeV2SecondaryActions canWrite={data.canWrite} />
      <HomeV2AdvancedEntry
        preference={data.preference}
        onPreferenceChange={data.setPreference}
      />
    </div>
  );
}
