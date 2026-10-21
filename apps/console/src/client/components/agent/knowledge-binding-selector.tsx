import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  useReadyKnowledgeIndexesCatalogQuery,
  type KnowledgeIndexResource,
} from "../../hooks/use-knowledge-memory";
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
  readonly onManifestChange: (next: string) => void;
}) {
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
      : [{ bindingName: "", knowledgeIndexIds: [] }],
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
      const normalized =
        next.length === 0 ? [{ bindingName: "", knowledgeIndexIds: [] }] : next;
      syncManifest(normalized);
      return normalized;
    });
  }

  return (
    <section className="panel">
      <h2 className="section-title">Knowledge bindings</h2>
      <p className="muted">
        Attach READY knowledge indexes by logical binding name. Only indexes in
        READY state can be selected. Manage sources and indexing in{" "}
        <Link to="/knowledge">Knowledge Studio</Link>.
      </p>
      {catalogQuery.isLoading ? (
        <p className="muted">Loading READY indexes…</p>
      ) : null}
      {readyIndexes.length === 0 && !catalogQuery.isLoading ? (
        <p className="muted">
          No READY indexes in this workspace yet. Create a source, run indexing,
          and wait for READY status before binding.
        </p>
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
              />
              {nameError !== undefined || duplicateName ? (
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
                    <label key={ki.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={props.disabled}
                        onChange={(event) =>
                          toggleIndex(index, ki.id, event.target.checked)
                        }
                      />{" "}
                      <span className="mono">{ki.id}</span>{" "}
                      <span className="muted">
                        ({source.name} / {source.key})
                      </span>
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
      <button
        type="button"
        className="button"
        disabled={props.disabled}
        onClick={addRow}
      >
        Add knowledge binding
      </button>
    </section>
  );
}
