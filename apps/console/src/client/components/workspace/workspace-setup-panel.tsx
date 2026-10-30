import { Link } from "react-router-dom";

import {
  buildWorkspaceSetupGuidance,
  setupGuidanceLabel,
} from "../../lib/workspace-setup-guidance";
import type { AgentResource } from "../../hooks/use-agents";
import type {
  ModelProfileResource,
  ModelProviderConnectionResource,
} from "../../hooks/use-models";

export function WorkspaceSetupPanel({
  controlPlaneReachable,
  agents,
  modelProfiles,
  modelConnections,
  hasBoundProfileVersion,
}: {
  readonly controlPlaneReachable: boolean;
  readonly agents: readonly AgentResource[] | undefined;
  readonly modelProfiles: readonly ModelProfileResource[] | undefined;
  readonly modelConnections:
    readonly ModelProviderConnectionResource[] | undefined;
  readonly hasBoundProfileVersion?: boolean;
}) {
  const items = buildWorkspaceSetupGuidance({
    controlPlaneReachable,
    agents,
    modelProfiles,
    modelConnections,
    hasBoundProfileVersion,
  });

  return (
    <section className="panel" aria-labelledby="workspace-setup-title">
      <h2 className="panel-title" id="workspace-setup-title">
        Workspace setup
      </h2>
      <p className="muted">
        Declarative agents execute through the built-in runtime (ModelGateway
        and ToolGateway). Model availability requires configured connections and
        profile versions in this workspace—not assumptions from a responding
        Console API.
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Area</th>
            <th>State</th>
            <th>Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.label}</td>
              <td>{setupGuidanceLabel(item.state)}</td>
              <td className="muted">{item.detail}</td>
              <td>
                <Link
                  className="button button-secondary"
                  to={item.configurePath}
                >
                  Configure
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
