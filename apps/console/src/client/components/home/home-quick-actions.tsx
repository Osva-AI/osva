import { Link } from "react-router-dom";

import { SectionPanel } from "../ui/section-panel";

export function HomeQuickActions({ canWrite }: { readonly canWrite: boolean }) {
  return (
    <SectionPanel title="Quick actions">
      <div className="action-grid">
        <Link className="action-tile" to="/agents">
          <strong>Open agents</strong>
          <span className="muted">Registry and Agent Studio entry points.</span>
        </Link>
        {canWrite ? (
          <Link className="action-tile" to="/agents/new">
            <strong>Create agent</strong>
            <span className="muted">Start a declarative agent.</span>
          </Link>
        ) : null}
        <Link className="action-tile" to="/workflows">
          <strong>Open workflows</strong>
          <span className="muted">Definitions, versions, and runs.</span>
        </Link>
        {canWrite ? (
          <Link className="action-tile" to="/workflows/new">
            <strong>Build workflow</strong>
            <span className="muted">Compose agents, tools, and approvals.</span>
          </Link>
        ) : null}
        <Link className="action-tile" to="/runs">
          <strong>View runs</strong>
          <span className="muted">Agent execution history.</span>
        </Link>
        <Link className="action-tile" to="/testing">
          <strong>Testing Studio</strong>
          <span className="muted">Evaluation suites and runs.</span>
        </Link>
      </div>
    </SectionPanel>
  );
}
