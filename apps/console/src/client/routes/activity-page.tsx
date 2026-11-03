import { LinkButton } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";

export function ActivityPage() {
  return (
    <div className="page-stack">
      <PageHeader
        title="Activity"
        subtitle="Agent runs and workflow runs use separate lifecycles. Choose the view that matches what you are troubleshooting."
      />
      <div className="grid-two">
        <SectionPanel title="Agent runs">
          <p className="panel-description muted">
            Inspect individual agent executions, attempts, and outputs.
          </p>
          <div className="panel-header-actions">
            <LinkButton variant="primary" to="/runs">
              Open agent runs
            </LinkButton>
          </div>
        </SectionPanel>
        <SectionPanel title="Workflow runs">
          <p className="panel-description muted">
            Follow orchestration progress, waits, and node-level status.
          </p>
          <div className="panel-header-actions">
            <LinkButton variant="primary" to="/workflow-runs">
              Open workflow runs
            </LinkButton>
          </div>
        </SectionPanel>
      </div>
    </div>
  );
}
