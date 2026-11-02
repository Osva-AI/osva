import { LinkButton } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { HomeActivePresentation } from "../components/home/home-active-presentation";
import { HomeAdvancedPresentation } from "../components/home/home-advanced-presentation";
import { HomeDegradedPresentation } from "../components/home/home-degraded-presentation";
import { HomeNewPresentation } from "../components/home/home-new-presentation";
import { HomePresentationSwitch } from "../components/home/home-presentation-switch";
import { useHomePageData } from "../hooks/use-home-page-data";

export function OverviewPage() {
  const data = useHomePageData();
  const { presentation, preference, setPreference } = data;

  return (
    <>
      <PageHeader
        title="Home"
        subtitle={
          presentation.state === "advanced"
            ? "Advanced presentation—dense registry and run summaries from existing Console APIs."
            : presentation.state === "new"
              ? "Outcome-oriented starting point for this workspace."
              : presentation.state === "active"
                ? "Continue work, recent activity, and operational signals."
                : "Workspace-scoped Home using existing Console APIs."
        }
        actions={
          <div className="action-row home-header-actions">
            <HomePresentationSwitch
              preference={preference}
              onPreferenceChange={setPreference}
            />
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
          </div>
        }
      />

      {!data.workspaceAligned ? (
        <LoadingBlock label="Select a workspace to view Home." />
      ) : null}

      {presentation.state === "loading" ? (
        <LoadingBlock label="Loading workspace Home…" />
      ) : null}

      {data.authContextQuery.isError && presentation.state !== "loading" ? (
        <ErrorState
          title="Could not load role"
          error={data.authContextQuery.error}
        />
      ) : null}

      {presentation.state === "degraded" ? (
        <HomeDegradedPresentation
          reason={presentation.reason}
          partialErrors={data.partialErrors}
          preference={preference}
          onPreferenceChange={setPreference}
        />
      ) : null}

      {presentation.state === "new" ? (
        <HomeNewPresentation data={data} />
      ) : null}

      {presentation.state === "active" ? (
        <HomeActivePresentation data={data} />
      ) : null}

      {presentation.state === "advanced" ? (
        <>
          {preference === "advanced" ? (
            <p className="muted home-advanced-note">
              <button
                type="button"
                className="button-link"
                onClick={() => {
                  setPreference("standard");
                }}
              >
                Return to Standard
              </button>{" "}
              to automatically show New or Active based on workspace evidence.
            </p>
          ) : null}
          <HomeAdvancedPresentation data={data} />
        </>
      ) : null}
    </>
  );
}
