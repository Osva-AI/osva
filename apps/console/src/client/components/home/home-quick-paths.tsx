import { Link } from "react-router-dom";

import { SectionPanel } from "../ui/section-panel";

export function HomeQuickPaths({ canWrite }: { readonly canWrite: boolean }) {
  return (
    <SectionPanel title="Quick paths">
      <div className="action-grid">
        <QuickPath
          title="Start with an agent"
          description="Browse agents or create one in Agent Studio."
          to={canWrite ? "/agents/new" : "/agents"}
          cta={canWrite ? "Create agent" : "View agents"}
        />
        <QuickPath
          title="Explore workflows"
          description="Review workflow definitions and versions."
          to="/workflows"
          cta="Open workflows"
        />
        <QuickPath
          title="Configure a model"
          description="Provider connections and model profiles."
          to="/models"
          cta={canWrite ? "Open models" : "View models"}
        />
        <QuickPath
          title="Open the full Console"
          description="Jump to runs, tools, memory, and testing."
          to="/runs"
          cta="View runs"
        />
      </div>
      {!canWrite ? (
        <p className="muted">
          Your role can view workspace resources. Create and configure actions
          require DEVELOPER, ADMIN, or OWNER.
        </p>
      ) : null}
    </SectionPanel>
  );
}

function QuickPath({
  title,
  description,
  to,
  cta,
}: {
  readonly title: string;
  readonly description: string;
  readonly to: string;
  readonly cta: string;
}) {
  return (
    <Link className="home-quick-path" to={to}>
      <strong>{title}</strong>
      <span className="muted">{description}</span>
      <span className="home-quick-path-cta">{cta} →</span>
    </Link>
  );
}
