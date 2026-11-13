import { Link } from "react-router-dom";

import { LinkButton } from "../ui/button";
import {
  buildAgentPickerHandoffPath,
  CONNECTOR_ADOPTION_JOURNEY,
  relatedExampleDocLinks,
  toolVersionHandoffSearch,
  type ConnectorExampleDocLink,
} from "../../lib/connector-agent-handoff";
import { DataTableRegion } from "../ui/data-table-region";

export interface ConnectorImportHandoffRow {
  readonly toolId: string;
  readonly toolVersionId: string;
  readonly toolKey: string;
  readonly remoteToolName?: string;
  readonly toolName?: string;
}

export function ConnectorImportHandoffPanel(props: {
  readonly connectorVersionId: string;
  readonly connectorName?: string;
  readonly catalogConnectorId?: string;
  readonly imported: readonly ConnectorImportHandoffRow[];
}) {
  const toolVersionIds = props.imported.map((row) => row.toolVersionId);
  const exampleLinks: readonly ConnectorExampleDocLink[] =
    props.catalogConnectorId !== undefined
      ? relatedExampleDocLinks(props.catalogConnectorId)
      : [];

  return (
    <section
      className="panel nested connector-import-handoff"
      data-testid="connector-import-handoff-panel"
    >
      <h3 className="section-title">Import complete — next steps</h3>
      <p className="muted">
        Import registered immutable ToolVersions in this workspace. Binding a
        tool on an AgentVersion does not execute it — authorized Runs invoke
        ToolGateway at run time.
      </p>
      <ol
        className="connector-adoption-journey"
        aria-label="Connector adoption journey"
      >
        {CONNECTOR_ADOPTION_JOURNEY.map((stage) => (
          <li key={stage.id}>
            <strong>{stage.label}</strong>
            <span className="muted"> — {stage.description}</span>
          </li>
        ))}
      </ol>
      <DataTableRegion caption="Imported ToolVersions">
        <thead>
          <tr>
            <th scope="col">Tool</th>
            <th scope="col">Remote MCP name</th>
            <th scope="col">ToolVersion</th>
            <th scope="col">Source ConnectorVersion</th>
          </tr>
        </thead>
        <tbody>
          {props.imported.map((row) => (
            <tr key={row.toolVersionId}>
              <td>
                <Link to={`/tools/${row.toolId}`}>
                  {row.toolName ?? row.toolKey}
                </Link>
              </td>
              <td className="mono">{row.remoteToolName ?? "—"}</td>
              <td className="mono">{row.toolVersionId}</td>
              <td className="mono">{props.connectorVersionId}</td>
            </tr>
          ))}
        </tbody>
      </DataTableRegion>
      <div className="toolbar">
        <LinkButton
          variant="primary"
          to={buildAgentPickerHandoffPath(toolVersionIds)}
          data-testid="connector-use-tools-in-agent"
        >
          Use tools in an agent
        </LinkButton>
        <LinkButton variant="secondary" to="/tools">
          Open tool registry
        </LinkButton>
      </div>
      <p className="muted">
        Agent Studio accepts optional{" "}
        <span className="mono">toolVersionIds</span> hints in the URL. Hints are
        revalidated against this workspace and never bypass ToolGateway
        authorization.
      </p>
      {exampleLinks.length > 0 ? (
        <div className="connector-import-example-links">
          <h4 className="section-title">Reference examples</h4>
          <p className="muted">
            These osva-examples journeys illustrate binding patterns. They are
            not evidence of live provider acceptance in your workspace.
          </p>
          <ul>
            {exampleLinks.map((link) => (
              <li key={link.exampleId}>
                <Link to={link.consolePath}>{link.title}</Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <details className="integrations-v2-tech-details">
        <summary>Handoff query preview</summary>
        <span className="mono">
          /agents
          {toolVersionHandoffSearch(toolVersionIds)}
        </span>
      </details>
    </section>
  );
}
