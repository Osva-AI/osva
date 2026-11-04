export function IntegrationsConceptsPanel() {
  return (
    <details className="integrations-v2-concepts-details panel">
      <summary className="integrations-v2-concepts-summary">
        Tools vs MCP connectors
      </summary>
      <p className="muted integrations-v2-concepts-lead">
        Connectors reach external MCP servers. Imported tools become immutable
        ToolVersions in your registry that agents bind at publish time.
      </p>
      <div className="integrations-v2-concepts-grid">
        <article className="integrations-v2-concept-card">
          <p className="integrations-v2-concept-title">Tool registry</p>
          <p className="muted">
            Internal and MCP tools with immutable versions. Agent Studio binds
            explicit ToolVersion IDs — not “latest”.
          </p>
        </article>
        <article className="integrations-v2-concept-card">
          <p className="integrations-v2-concept-title">MCP connectors</p>
          <p className="muted">
            Connector identities with immutable ConnectorVersions. Discover
            remote capabilities, review, then import into the registry.
          </p>
        </article>
      </div>
    </details>
  );
}
