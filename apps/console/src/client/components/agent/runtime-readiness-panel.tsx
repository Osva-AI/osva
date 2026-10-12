import {
  buildRuntimeReadiness,
  readinessLabel,
} from "../../lib/agent-readiness";
import type { AgentVersionResource } from "../../hooks/use-agents";

export function RuntimeReadinessPanel({
  controlPlaneReachable,
  selectedVersion,
}: {
  readonly controlPlaneReachable: boolean;
  readonly selectedVersion?: AgentVersionResource;
}) {
  const items = buildRuntimeReadiness({
    controlPlaneReachable,
    selectedVersion,
  });

  return (
    <section className="panel" aria-labelledby="runtime-readiness-title">
      <h2 className="panel-title" id="runtime-readiness-title">
        Runtime readiness
      </h2>
      <p className="muted">
        Verified ready is used only when an existing Console API actually proves
        the fact. Worker health, container images, and local files are never
        inferred from a successful Console response.
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Prerequisite</th>
            <th>State</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.label}</td>
              <td>{readinessLabel(item.state)}</td>
              <td className="muted">{item.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
