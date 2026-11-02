import { Link } from "react-router-dom";

import {
  buildWorkspaceSetupGuidance,
  setupGuidanceLabel,
  type SetupGuidanceItem,
  type SetupGuidanceState,
} from "../../lib/workspace-setup-guidance";
import type { AgentResource } from "../../hooks/use-agents";
import type {
  ModelProfileResource,
  ModelProviderConnectionResource,
} from "../../hooks/use-models";
import { SectionPanel } from "../ui/section-panel";

function readinessTone(state: SetupGuidanceState): string {
  switch (state) {
    case "verified_ready":
      return "home-readiness-ready";
    case "requires_setup":
      return "home-readiness-action";
    case "not_verifiable":
      return "home-readiness-unknown";
  }
}

function resolveConfigurePath(
  item: SetupGuidanceItem,
  canWrite: boolean,
): string {
  if (!canWrite && item.configurePath === "/agents/new") {
    return "/agents";
  }
  if (!canWrite && item.configurePath === "/models") {
    return "/models";
  }
  return item.configurePath;
}

function HomeReadinessCard({
  item,
  canWrite,
}: {
  readonly item: SetupGuidanceItem;
  readonly canWrite: boolean;
}) {
  const configurePath = resolveConfigurePath(item, canWrite);
  return (
    <article className={`home-readiness-card ${readinessTone(item.state)}`}>
      <header className="home-readiness-card-header">
        <h3 className="home-readiness-card-title">{item.label}</h3>
        <span className="home-readiness-badge">
          {setupGuidanceLabel(item.state)}
        </span>
      </header>
      <p className="muted home-readiness-detail">{item.detail}</p>
      {item.state === "requires_setup" ? (
        <Link className="home-readiness-link" to={configurePath}>
          {canWrite ? "Set up" : "View"}
        </Link>
      ) : item.state === "not_verifiable" ? (
        <Link className="home-readiness-link" to={configurePath}>
          Learn more
        </Link>
      ) : (
        <Link className="home-readiness-link" to={configurePath}>
          Review
        </Link>
      )}
    </article>
  );
}

export function HomeReadinessCards({
  controlPlaneReachable,
  agents,
  modelProfiles,
  modelConnections,
  hasBoundProfileVersion,
  compact,
  canWrite = true,
}: {
  readonly controlPlaneReachable: boolean;
  readonly agents: readonly AgentResource[] | undefined;
  readonly modelProfiles: readonly ModelProfileResource[] | undefined;
  readonly modelConnections:
    readonly ModelProviderConnectionResource[] | undefined;
  readonly hasBoundProfileVersion?: boolean;
  readonly compact?: boolean;
  readonly canWrite?: boolean;
}) {
  const items = buildWorkspaceSetupGuidance({
    controlPlaneReachable,
    agents,
    modelProfiles,
    modelConnections,
    hasBoundProfileVersion,
  });

  const relevant = compact
    ? items.filter(
        (item) => item.state === "requires_setup" || item.id === "models",
      )
    : items;

  return (
    <SectionPanel
      title="Workspace readiness"
      description="Setup signals from this workspace. A registered connection does not guarantee successful execution."
    >
      <div className="home-readiness-grid">
        {relevant.map((item) => (
          <HomeReadinessCard key={item.id} item={item} canWrite={canWrite} />
        ))}
      </div>
    </SectionPanel>
  );
}
