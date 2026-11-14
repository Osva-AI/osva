import { Link } from "react-router-dom";

import {
  buildAgentVersionCreateHandoffPath,
  validateToolVersionHandoff,
  type ToolCatalogRow,
} from "../../lib/connector-agent-handoff";

export function ToolVersionHandoffBanner(props: {
  readonly hintedIds: readonly string[];
  readonly catalog: readonly ToolCatalogRow[] | undefined;
  readonly catalogLoading: boolean;
  readonly canWrite: boolean;
}) {
  const { validated, rejected } = validateToolVersionHandoff(
    props.hintedIds,
    props.catalog,
  );

  if (props.hintedIds.length === 0) {
    return null;
  }

  return (
    <section
      className="panel connector-tool-handoff-banner"
      role="status"
      data-testid="tool-version-handoff-banner"
    >
      <h2 className="section-title">Bind imported tools</h2>
      <p className="muted">
        Choose an agent below to open Agent Studio. ToolVersion ids from
        navigation are hints only — Console revalidates workspace access before
        preselecting bindings. No agent is created automatically and no tool is
        executed from this page.
      </p>
      {props.catalogLoading ? (
        <p className="muted">Loading workspace tool catalog…</p>
      ) : null}
      {validated.length > 0 ? (
        <ul data-testid="tool-version-handoff-validated">
          {validated.map((entry) => (
            <li key={entry.toolVersionId}>
              {entry.toolName} ({entry.toolKey}) ·{" "}
              <span className="mono">{entry.toolVersionId}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {rejected.length > 0 ? (
        <p className="error-inline" role="alert">
          Ignored {rejected.length} id
          {rejected.length === 1 ? "" : "s"} not visible in this workspace:{" "}
          <span className="mono">{rejected.join(", ")}</span>
        </p>
      ) : null}
      {!props.canWrite ? (
        <p className="muted">
          Read-only members can inspect agents but cannot publish new
          AgentVersions with tool bindings.
        </p>
      ) : null}
      {validated.length > 0 && props.canWrite ? (
        <p className="muted">
          Open an agent, then choose <strong>New AgentVersion</strong> — or use
          the per-agent link in the table when available.
        </p>
      ) : null}
    </section>
  );
}

export function AgentHandoffVersionLink(props: {
  readonly agentId: string;
  readonly toolVersionIds: readonly string[];
  readonly canWrite: boolean;
}) {
  if (!props.canWrite || props.toolVersionIds.length === 0) {
    return null;
  }
  return (
    <Link
      className="button button-secondary"
      to={buildAgentVersionCreateHandoffPath(
        props.agentId,
        props.toolVersionIds,
      )}
      data-testid={`agent-handoff-version-${props.agentId}`}
    >
      Bind tools
    </Link>
  );
}
