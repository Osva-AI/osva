export function TestingConceptsPanel() {
  return (
    <details className="testing-v2-concepts-details panel">
      <summary className="testing-v2-concepts-summary">
        Playground vs batch evaluation
      </summary>
      <div className="testing-v2-concepts-grid">
        <article className="testing-v2-concept-card">
          <p className="testing-v2-concept-title">Agent playground</p>
          <p className="muted">
            Ad-hoc single runs against a published agent version. Same Run
            lifecycle as production — ideal for quick manual checks.
          </p>
        </article>
        <article className="testing-v2-concept-card">
          <p className="testing-v2-concept-title">Evaluation suites & runs</p>
          <p className="muted">
            Immutable suite versions define JSON test cases. A batch evaluation
            run executes every case and optional quality gates assess results
            separately from run COMPLETED status.
          </p>
        </article>
      </div>
    </details>
  );
}
