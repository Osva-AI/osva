import { useState, type FormEvent } from "react";

import { Button } from "../ui/button";
import { TextField } from "../ui/field";
import { SectionPanel } from "../ui/section-panel";
import {
  useKnowledgeRetrieveMutation,
  type KnowledgeHitResource,
  type KnowledgeIndexResource,
  type KnowledgeSourceResource,
} from "../../hooks/use-knowledge-memory";
import {
  formatKnowledgeHitLocation,
  formatKnowledgeIndexSelectLabel,
} from "../../lib/knowledge-resource-presentation";

function KnowledgeHitCard(props: { readonly hit: KnowledgeHitResource }) {
  const location = formatKnowledgeHitLocation(props.hit);
  const attributeKeys = Object.keys(props.hit.attributes);

  return (
    <article className="knowledge-v2-hit-card">
      <header className="knowledge-v2-hit-header">
        <p className="knowledge-v2-hit-score">
          Score {props.hit.score.toFixed(4)}
        </p>
        {location !== undefined ? (
          <p className="muted knowledge-v2-hit-location">{location}</p>
        ) : null}
      </header>
      <p className="knowledge-v2-hit-text">{props.hit.text}</p>
      <details className="knowledge-v2-tech-details">
        <summary>References</summary>
        <dl className="meta-grid">
          <div>
            <dt>Chunk</dt>
            <dd className="mono">{props.hit.knowledgeChunkId}</dd>
          </div>
          <div>
            <dt>Index</dt>
            <dd className="mono">{props.hit.knowledgeIndexId}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd className="mono">{props.hit.knowledgeSourceId}</dd>
          </div>
        </dl>
        {attributeKeys.length > 0 ? (
          <pre className="json-preview">
            {JSON.stringify(props.hit.attributes, null, 2)}
          </pre>
        ) : null}
      </details>
    </article>
  );
}

export function KnowledgeRetrievalPanel(props: {
  readonly source: KnowledgeSourceResource;
  readonly readyIndexes: readonly KnowledgeIndexResource[];
}) {
  const retrieveMutation = useKnowledgeRetrieveMutation();
  const [retrieveQuery, setRetrieveQuery] = useState("");
  const [selectedIndexIds, setSelectedIndexIds] = useState<string[]>([]);
  const [hits, setHits] = useState<readonly KnowledgeHitResource[]>([]);
  const [retrieveError, setRetrieveError] = useState<string | undefined>();

  async function handleRetrieve(event: FormEvent): Promise<void> {
    event.preventDefault();
    setRetrieveError(undefined);
    setHits([]);
    const ids =
      selectedIndexIds.length > 0
        ? selectedIndexIds
        : props.readyIndexes.map((index) => index.id);
    if (ids.length === 0) {
      setRetrieveError(
        "No READY index on this source. Create an index and wait for READY before searching.",
      );
      return;
    }
    try {
      const result = await retrieveMutation.mutateAsync({
        knowledgeIndexIds: ids,
        query: retrieveQuery.trim(),
        topK: 5,
      });
      setHits(result.hits);
    } catch (error) {
      setRetrieveError(
        error instanceof Error ? error.message : "Retrieval failed.",
      );
    }
  }

  return (
    <SectionPanel
      title="Test retrieval"
      description="Search READY indexes on this source. Results use backend scores and text only — nothing is fabricated in the UI."
    >
      {props.readyIndexes.length === 0 ? (
        <p className="muted" role="status">
          No READY indexes yet. Create an index above and wait for the worker to
          finish before testing retrieval.
        </p>
      ) : null}

      <form
        className="knowledge-v2-retrieve-form stack"
        onSubmit={(event) => void handleRetrieve(event)}
      >
        <TextField
          id="retrieve-query"
          label="Search query"
          value={retrieveQuery}
          onChange={(event) => setRetrieveQuery(event.target.value)}
          hint="Natural language question or keywords. Top 5 hits are returned."
          required
          disabled={props.readyIndexes.length === 0}
        />

        {props.readyIndexes.length > 0 ? (
          <fieldset className="knowledge-v2-index-picker">
            <legend>READY indexes (optional filter)</legend>
            <p className="muted">
              Leave all unchecked to search every READY index on this source.
            </p>
            {props.readyIndexes.map((index) => {
              const checked = selectedIndexIds.includes(index.id);
              return (
                <label key={index.id} className="knowledge-v2-index-option">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      setSelectedIndexIds((current) => {
                        if (event.target.checked) {
                          return [...current, index.id];
                        }
                        return current.filter((id) => id !== index.id);
                      });
                    }}
                  />
                  <span>
                    {formatKnowledgeIndexSelectLabel({
                      source: props.source,
                      index,
                    })}
                  </span>
                </label>
              );
            })}
          </fieldset>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          disabled={
            retrieveMutation.isPending || props.readyIndexes.length === 0
          }
        >
          {retrieveMutation.isPending ? "Searching…" : "Search"}
        </Button>
      </form>

      {retrieveError !== undefined ? (
        <p className="error-inline" role="alert">
          {retrieveError}
        </p>
      ) : null}

      {hits.length === 0 &&
      retrieveMutation.isSuccess &&
      retrieveQuery.trim().length > 0 ? (
        <p className="muted" role="status">
          No hits returned for this query.
        </p>
      ) : null}

      {hits.length > 0 ? (
        <div className="knowledge-v2-hit-list" role="list">
          {hits.map((hit) => (
            <KnowledgeHitCard key={hit.knowledgeChunkId} hit={hit} />
          ))}
        </div>
      ) : null}
    </SectionPanel>
  );
}
