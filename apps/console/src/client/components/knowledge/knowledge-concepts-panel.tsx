export function KnowledgeConceptsPanel() {
  return (
    <details className="knowledge-v2-concepts-details panel">
      <summary className="knowledge-v2-concepts-summary">
        Sources, indexes, and agent bindings
      </summary>
      <p className="muted knowledge-v2-concepts-lead">
        A knowledge source points at an existing workspace artifact. Indexing
        runs asynchronously; only READY indexes can be searched or bound to
        agents.
      </p>
      <div className="knowledge-v2-concepts-grid">
        <article className="knowledge-v2-concept-card">
          <p className="knowledge-v2-concept-title">Knowledge source</p>
          <p className="muted">
            Named registry entry tied to one artifact. Upload artifacts through
            the control plane API — the console does not upload files here.
          </p>
        </article>
        <article className="knowledge-v2-concept-card">
          <p className="knowledge-v2-concept-title">Knowledge index</p>
          <p className="muted">
            Immutable pipeline run (parse, chunk, embed). Status moves through
            Pending → Running → Ready or Failed using worker-reported state
            only.
          </p>
        </article>
      </div>
    </details>
  );
}
