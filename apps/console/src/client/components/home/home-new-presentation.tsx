import { useAgentVersionCatalogQuery } from "../../hooks/use-agents";
import type { HomePageData } from "../../hooks/use-home-page-data";
import { HomeGettingStartedPreview } from "./home-getting-started-preview";
import { HomeHero } from "./home-hero";
import { HomePartialErrors } from "./home-partial-errors";
import { HomeQuickPaths } from "./home-quick-paths";
import { HomeReadinessCards } from "./home-readiness-cards";

export function HomeNewPresentation({ data }: { readonly data: HomePageData }) {
  const versionCatalogQuery = useAgentVersionCatalogQuery();
  const onboardingLoading =
    data.agentsQuery.isLoading ||
    versionCatalogQuery.isLoading ||
    data.modelBindingQuery.isLoading ||
    data.modelProfilesQuery.isLoading ||
    data.modelConnectionsQuery.isLoading ||
    data.recentRunsQuery.isLoading;
  const onboardingError =
    data.agentsQuery.isError ||
    versionCatalogQuery.isError ||
    data.modelBindingQuery.isError ||
    data.recentRunsQuery.isError;

  return (
    <div className="home-stack">
      <HomePartialErrors messages={data.partialErrors} />
      <HomeHero canWrite={data.canWrite} canExecute={data.canExecute} />
      <HomeGettingStartedPreview
        agents={data.agentsQuery.data?.agents}
        agentVersions={versionCatalogQuery.data?.entries}
        modelProfiles={data.modelProfilesQuery.data?.modelProfiles}
        modelProfileVersions={data.modelBindingQuery.data?.profileVersions}
        modelConnections={data.modelConnectionsQuery.data?.connections}
        runs={data.recentRunsQuery.data?.runs}
        runsListHasMore={data.recentRunsQuery.data?.nextCursor !== undefined}
        workflows={data.workflowsQuery.data?.workflows}
        progressLoading={onboardingLoading}
        progressLoadError={onboardingError}
        canWrite={data.canWrite}
        canExecute={data.canExecute}
      />
      <HomeReadinessCards
        controlPlaneReachable={data.authContextQuery.data !== undefined}
        agents={data.agentsQuery.data?.agents}
        modelProfiles={data.modelProfilesQuery.data?.modelProfiles}
        modelConnections={data.modelConnectionsQuery.data?.connections}
        hasBoundProfileVersion={
          data.modelBindingQuery.data?.hasBoundProfileVersion
        }
        canWrite={data.canWrite}
      />
      <HomeQuickPaths canWrite={data.canWrite} />
    </div>
  );
}
