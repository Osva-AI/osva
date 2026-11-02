import { LinkButton } from "../ui/button";
import type { HomePageData } from "../../hooks/use-home-page-data";
import { HomeAttentionPanel } from "./home-attention-panel";
import { HomeContinueWorking } from "./home-continue-working";
import { HomePartialErrors } from "./home-partial-errors";
import { HomeQuickActions } from "./home-quick-actions";
import { HomeReadinessCards } from "./home-readiness-cards";
import { HomeRecentActivity } from "./home-recent-activity";
import { SectionPanel } from "../ui/section-panel";

export function HomeActivePresentation({
  data,
}: {
  readonly data: HomePageData;
}) {
  const workspaceName = data.workspace?.name ?? "your workspace";

  return (
    <div className="home-stack">
      <HomePartialErrors messages={data.partialErrors} />
      <SectionPanel className="home-welcome-panel">
        <p className="home-welcome-kicker">Welcome back</p>
        <h2 className="home-welcome-title">{workspaceName}</h2>
        <p className="muted">
          Pick up agents, workflows, or runs—or open Testing Studio for
          evaluation work.
        </p>
        <div className="action-row">
          {data.canWrite ? (
            <>
              <LinkButton variant="primary" to="/agents/new">
                Create agent
              </LinkButton>
              <LinkButton variant="secondary" to="/workflows/new">
                Build workflow
              </LinkButton>
            </>
          ) : null}
          <LinkButton variant="secondary" to="/runs">
            View runs
          </LinkButton>
          <LinkButton variant="secondary" to="/testing">
            Testing Studio
          </LinkButton>
        </div>
      </SectionPanel>

      <HomeContinueWorking
        agents={data.agents}
        workflows={data.workflows}
        recentRuns={data.recentRuns}
      />
      <HomeAttentionPanel attentionItems={data.attentionItems} />
      <HomeRecentActivity
        recentRuns={data.recentRuns}
        recentWorkflowRuns={data.recentWorkflowRuns}
        runsPresentation={data.runsPresentation}
        workflowRunsPresentation={data.workflowRunsPresentation}
        runsError={
          data.recentRunsQuery.isError ? data.recentRunsQuery.error : undefined
        }
        workflowRunsError={
          data.recentWorkflowRunsQuery.isError
            ? data.recentWorkflowRunsQuery.error
            : undefined
        }
        canExecute={data.canExecute}
        canWrite={data.canWrite}
      />
      <HomeQuickActions canWrite={data.canWrite} />
      <HomeReadinessCards
        compact
        controlPlaneReachable={data.authContextQuery.data !== undefined}
        agents={data.agentsQuery.data?.agents}
        modelProfiles={data.modelProfilesQuery.data?.modelProfiles}
        modelConnections={data.modelConnectionsQuery.data?.connections}
        hasBoundProfileVersion={
          data.modelBindingQuery.data?.hasBoundProfileVersion
        }
        canWrite={data.canWrite}
      />
    </div>
  );
}
