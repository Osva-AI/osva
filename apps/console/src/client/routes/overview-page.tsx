import { ErrorState } from "../components/error-state/error-state";
import { HomeActivePresentation } from "../components/home/home-active-presentation";
import { HomeAdvancedPresentation } from "../components/home/home-advanced-presentation";
import { HomeDegradedPresentation } from "../components/home/home-degraded-presentation";
import { HomeNewPresentation } from "../components/home/home-new-presentation";
import { HomeV2AdvancedEntry } from "../components/home/home-v2-advanced-entry";
import { LoadingBlock } from "../components/loading/loading-block";
import { useHomePageData } from "../hooks/use-home-page-data";

export function OverviewPage() {
  const data = useHomePageData();
  const { presentation } = data;

  return (
    <>
      {!data.workspaceAligned ? (
        <LoadingBlock label="Select a workspace to view Home." />
      ) : null}

      {presentation.state === "loading" ? (
        <div className="home-v2 home-v2-loading">
          <LoadingBlock label="Loading your workspace Home…" />
        </div>
      ) : null}

      {data.authContextQuery.isError && presentation.state !== "loading" ? (
        <ErrorState
          title="Could not load role"
          error={data.authContextQuery.error}
        />
      ) : null}

      {presentation.state === "degraded" ? (
        <HomeDegradedPresentation reason={presentation.reason} data={data} />
      ) : null}

      {presentation.state === "new" ? (
        <HomeNewPresentation data={data} />
      ) : null}

      {presentation.state === "active" ? (
        <HomeActivePresentation data={data} />
      ) : null}

      {presentation.state === "advanced" ? (
        <div className="home-v2 home-v2-advanced">
          <p className="home-v2-page-eyebrow">Home · Advanced</p>
          <HomeV2AdvancedEntry
            preference={data.preference}
            onPreferenceChange={data.setPreference}
          />
          <HomeAdvancedPresentation data={data} />
        </div>
      ) : null}
    </>
  );
}
