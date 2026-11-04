import { Link } from "react-router-dom";

export function MemoryConceptsPanel() {
  return (
    <details className="memory-v2-concepts-details panel">
      <summary className="memory-v2-concepts-summary">
        Memory vs Knowledge
      </summary>
      <div className="memory-v2-concepts-grid">
        <article className="memory-v2-concept-card">
          <p className="memory-v2-concept-title">Memory</p>
          <p className="muted">
            Durable JSON key–value records in namespaces. Agents access them
            through the memory gateway with READ_ONLY or READ_WRITE bindings.
            This console does not edit record values.
          </p>
        </article>
        <article className="memory-v2-concept-card">
          <p className="memory-v2-concept-title">Knowledge</p>
          <p className="muted">
            Artifact-backed sources indexed for semantic retrieval. Use{" "}
            <Link to="/knowledge">Knowledge</Link> for RAG-style search — not
            for arbitrary JSON record storage.
          </p>
        </article>
      </div>
    </details>
  );
}
