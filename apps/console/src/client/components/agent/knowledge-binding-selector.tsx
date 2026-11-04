import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  useReadyKnowledgeIndexesCatalogQuery,
  type KnowledgeIndexResource,
} from "../../hooks/use-knowledge-memory";
import { formatKnowledgeIndexSelectLabel } from "../../lib/knowledge-resource-presentation";
import {
  applyKnowledgeBindingsToManifestText,
  describeKnowledgeBindingNameError,
  extractKnowledgeBindingRows,
  type AgentKnowledgeBindingRow,
} from "../../lib/agent-knowledge-bindings";
import { parseWorkflowRunInputJson } from "../../lib/workflow-run-input";

export function KnowledgeBindingSelector(props: {
  readonly manifestText: string;
  readonly disabled?: boolean;
  readonly presentation?: "default" | "studio";
  readonly onManifestChange: (next: string) => void;
}) {
  const presentation = props.presentation ?? "default";
  const catalogQuery = useReadyKnowledgeIndexesCatalogQuery(true);
  const parsed = parseWorkflowRunInputJson(props.manifestText);
  const rowsFromManifest = parsed.ok
    ? extractKnowledgeBindingRows(parsed.value)
    : [];

  const [draftRows, setDraftRows] = useState<AgentKnowledgeBindingRow[]>(() =>
    rowsFromManifest.length > 0
      ? rowsFromManifest.map((row) => ({
          ...row,
          knowledgeIndexIds: [...row.knowledgeIndexIds],
        }))
      : presentation === "studio"
        ? []
        : [{ bindingName: "", knowledgeIndexIds: [] }],
  );
  const [touchedRows, setTouchedRows] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  const readyIndexes = catalogQuery.data ?? [];
  const indexById = useMemo(() => {
    const map = new Map<string, KnowledgeIndexResource>();
    for (const entry of readyIndexes) {
      map.set(entry.index.id, entry.index);
    }
    return map;
  }, [readyIndexes]);

  function syncManifest(nextRows: readonly AgentKnowledgeBindingRow[]) {
    props.onManifestChange(
      applyKnowledgeBindingsToManifestText(props.manifestText, nextRows),
    );
  }

  function updateRow(
    index: number,
    patch: Partial<AgentKnowledgeBindingRow>,
  ): void {
    setDraftRows((current) => {
      const next = current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      );
      syncManifest(next);
      return next;
    });
  }

  function toggleIndex(
    rowIndex: number,
    indexId: string,
    checked: boolean,
  ): void {
    setDraftRows((current) => {
      const next = current.map((row, i) => {
        if (i !== rowIndex) {
          return row;
        }
        const set = new Set(row.knowledgeIndexIds);
        if (checked) {
          set.add(indexId);
        } else {
          set.delete(indexId);
        }
        return { ...row, knowledgeIndexIds: [...set] };
      });
      syncManifest(next);
      return next;
    });
  }

  function addRow(): void {
    setDraftRows((current) => [
      ...current,
      { bindingName: "", knowledgeIndexIds: [] },
    ]);
  }

  function removeRow(index: number): void {
    setDraftRows((current) => {
      const next = current.filter((_row, rowIndex) => rowIndex !== index);
      syncManifest(next);
      return next;
    });
  }

  function markTouched(index: number): void {
    setTouchedRows((current) => new Set([...current, index]));
  }

  return (
    <section className="panel">
      <h2 className="section-title">Knowledge bindings</h2>
      <p className="muted">
        Attach READY knowledge indexes by logical binding name. Only indexes in
        READY state can be selected. Manage sources and indexing in{" "}
        <Link to="/knowledge">Knowledge</Link>.
      </p>
      {catalogQuery.isLoading ? (
        <p className="muted">Loading READY indexes…</p>
      ) : null}
      {readyIndexes.length === 0 && !catalogQuery.isLoading ? (
        <div className="agent-studio-capability-empty" role="status">
          <p className="muted">
            No knowledge indexes are READY in this workspace. Set up a source in
            Knowledge, wait for READY, then return — your draft is preserved.
          </p>
          <Link className="button button-secondary" to="/knowledge">
            Open Knowledge
          </Link>
        </div>
      ) : null}
      {presentation === "studio" &&
      readyIndexes.length > 0 &&
      draftRows.length === 0 ? (
        <div className="agent-studio-capability-empty">
          <p className="muted">
            Add a knowledge binding when you need grounded answers from indexes.
          </p>
          <button
            type="button"
            className="button"
            disabled={props.disabled}
            onClick={addRow}
          >
            Add knowledge binding
          </button>
        </div>
      ) : null}
      {draftRows.map((row, index) => {
        const nameError = describeKnowledgeBindingNameError(row.bindingName);
        const duplicateName =
          row.bindingName.trim().length > 0 &&
          draftRows.filter(
            (other) =>
              other.bindingName.trim() === row.bindingName.trim() &&
              other !== row,
          ).length > 0;
        const showNameError =
          (nameError !== undefined || duplicateName) &&
          (presentation !== "studio" ||
            touchedRows.has(index) ||
            row.bindingName.trim().length > 0 ||
            row.knowledgeIndexIds.length > 0);
        return (
          <div className="filters" key={`knowledge-binding-${String(index)}`}>
            <div className="field">
              <label htmlFor={`knowledge-binding-name-${String(index)}`}>
                Binding name
              </label>
              <input
                id={`knowledge-binding-name-${String(index)}`}
                value={row.bindingName}
                disabled={props.disabled}
                onChange={(event) =>
                  updateRow(index, { bindingName: event.target.value })
                }
                onBlur={() => markTouched(index)}
              />
              {showNameError ? (
                <p className="error-inline" role="alert">
                  {duplicateName ? "Binding names must be unique." : nameError}
                </p>
              ) : null}
            </div>
            <div className="field">
              <span className="field-label">READY indexes</span>
              <div className="checkbox-list">
                {readyIndexes.map(({ source, index: ki }) => {
                  const checked = row.knowledgeIndexIds.includes(ki.id);
                  return (
                    <label key={ki.id} className="knowledge-v2-binding-option">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={props.disabled}
                        onChange={(event) =>
                          toggleIndex(index, ki.id, event.target.checked)
                        }
                      />
                      <span>
                        {formatKnowledgeIndexSelectLabel({ source, index: ki })}
                      </span>{" "}
                      <Link
                        to={`/knowledge/sources/${encodeURIComponent(source.id)}`}
                      >
                        View source
                      </Link>
                      <details className="knowledge-v2-tech-details inline-details">
                        <summary>Index ID</summary>
                        <span className="mono">{ki.id}</span>
                      </details>
                    </label>
                  );
                })}
              </div>
              {row.knowledgeIndexIds.some((id) => !indexById.has(id)) ? (
                <p className="muted">
                  Some bound index IDs are not READY or are unavailable in this
                  workspace. Remove or re-index them before publishing.
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="button"
              disabled={props.disabled}
              onClick={() => removeRow(index)}
            >
              Remove binding
            </button>
          </div>
        );
      })}
      {draftRows.length > 0 ? (
        <button
          type="button"
          className="button"
          disabled={props.disabled}
          onClick={addRow}
        >
          Add knowledge binding
        </button>
      ) : null}
    </section>
  );
}
