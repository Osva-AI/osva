export function ModelsConceptsPanel() {
  return (
    <details className="models-v2-concepts-details panel">
      <summary className="models-v2-concepts-summary">
        How models work in OSVA
      </summary>
      <p className="muted models-v2-concepts-lead">
        Provider connections hold credentials and endpoints. Model profiles hold
        immutable versions agents bind in Studio.
      </p>
      <div className="models-v2-concepts-grid">
        <article className="models-v2-concept-card">
          <p className="models-v2-concept-title">Provider connections</p>
          <p className="muted">
            Workspace-owned endpoints and secret references. Credentials are
            never shown after save.
          </p>
        </article>
        <article className="models-v2-concept-card">
          <p className="models-v2-concept-title">Model profiles</p>
          <p className="muted">
            Named bundles of immutable versions with provider model ids and
            optional connection bindings.
          </p>
        </article>
      </div>
    </details>
  );
}
