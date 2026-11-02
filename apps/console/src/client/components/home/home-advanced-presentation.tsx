import { Link } from "react-router-dom";

import type { HomePageData } from "../../hooks/use-home-page-data";
import { WorkspaceSetupPanel } from "../workspace/workspace-setup-panel";
import { HomeAttentionPanel } from "./home-attention-panel";
import { HomePartialErrors } from "./home-partial-errors";
import { HomeQuickActions } from "./home-quick-actions";
import { HomeRecentActivity } from "./home-recent-activity";
import { SectionPanel } from "../ui/section-panel";
import { ErrorState } from "../error-state/error-state";

export function HomeAdvancedPresentation({
  data,
}: {
  readonly data: HomePageData;
}) {
  return (
    <div className="home-stack home-advanced">
      <HomePartialErrors messages={data.partialErrors} />
      <section className="overview-metrics">
        <article className="metric-card">
          <h3 className="metric-label">{data.agentCountView.label}</h3>
          <p className="metric-value">
            {data.agentCountView.value === undefined
              ? "—"
              : data.agentCountView.value}
          </p>
          <p className="muted metric-detail">{data.agentCountView.detail}</p>
          <Link to="/agents">Open agents</Link>
        </article>
        <article className="metric-card">
          <h3 className="metric-label">{data.workflowCountView.label}</h3>
          <p className="metric-value">
            {data.workflowCountView.value === undefined
              ? "—"
              : data.workflowCountView.value}
          </p>
          <p className="muted metric-detail">{data.workflowCountView.detail}</p>
          <Link to="/workflows">Open workflows</Link>
        </article>
      </section>

      <SectionPanel title="Resource navigation">
        <div className="action-grid">
          <Link className="action-tile" to="/agents">
            <strong>Agents</strong>
            <span className="muted">Registry and versions</span>
          </Link>
          <Link className="action-tile" to="/workflows">
            <strong>Workflows</strong>
            <span className="muted">Builder and versions</span>
          </Link>
          <Link className="action-tile" to="/runs">
            <strong>Runs</strong>
            <span className="muted">Agent executions</span>
          </Link>
          <Link className="action-tile" to="/workflow-runs">
            <strong>Workflow runs</strong>
            <span className="muted">Durable orchestration</span>
          </Link>
          <Link className="action-tile" to="/models">
            <strong>Models</strong>
            <span className="muted">Connections and profiles</span>
          </Link>
          <Link className="action-tile" to="/tools">
            <strong>Tools</strong>
            <span className="muted">Registry and connectors</span>
          </Link>
          <Link className="action-tile" to="/testing">
            <strong>Testing Studio</strong>
            <span className="muted">Evaluations</span>
          </Link>
          <Link className="action-tile" to="/onboarding">
            <strong>Getting started</strong>
            <span className="muted">First-agent checklist</span>
          </Link>
          <Link className="action-tile" to="/examples">
            <strong>Examples</strong>
            <span className="muted">Verified osva-examples catalog</span>
          </Link>
        </div>
      </SectionPanel>

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

      <WorkspaceSetupPanel
        controlPlaneReachable={data.authContextQuery.data !== undefined}
        agents={data.agentsQuery.data?.agents}
        modelProfiles={data.modelProfilesQuery.data?.modelProfiles}
        modelConnections={data.modelConnectionsQuery.data?.connections}
        hasBoundProfileVersion={
          data.modelBindingQuery.data?.hasBoundProfileVersion
        }
      />

      <SectionPanel title="Workspace metadata">
        {data.authContextQuery.isError ? (
          <ErrorState
            title="Could not load role"
            error={data.authContextQuery.error}
          />
        ) : (
          <dl className="overview-meta-grid">
            <div>
              <dt>Name</dt>
              <dd>{data.workspace?.name ?? "—"}</dd>
            </div>
            <div>
              <dt>Workspace ID</dt>
              <dd className="mono">{data.workspace?.workspaceId ?? "—"}</dd>
            </div>
            <div>
              <dt>Your role</dt>
              <dd className="mono">{data.role}</dd>
            </div>
            <div>
              <dt>Presentation</dt>
              <dd className="mono">Advanced (local preference)</dd>
            </div>
          </dl>
        )}
        <p className="muted">
          Registry counts reflect full lists; run sections show recent pages
          only.
        </p>
      </SectionPanel>
    </div>
  );
}
