import { useState } from "react";
import { Link } from "react-router-dom";

import type { MemoryAccessMode } from "@osva-ai/contracts";

import { useMemoryNamespacesQuery } from "../../hooks/use-knowledge-memory";
import {
  applyMemoryBindingsToManifestText,
  describeMemoryBindingNameError,
  extractMemoryBindingRows,
  type AgentMemoryBindingRow,
} from "../../lib/agent-memory-bindings";
import { parseWorkflowRunInputJson } from "../../lib/workflow-run-input";

export function MemoryBindingSelector(props: {
  readonly manifestText: string;
  readonly disabled?: boolean;
  readonly presentation?: "default" | "studio";
  readonly onManifestChange: (next: string) => void;
}) {
  const presentation = props.presentation ?? "default";
  const namespacesQuery = useMemoryNamespacesQuery();
  const parsed = parseWorkflowRunInputJson(props.manifestText);
  const rowsFromManifest = parsed.ok
    ? extractMemoryBindingRows(parsed.value)
    : [];

  const [draftRows, setDraftRows] = useState<AgentMemoryBindingRow[]>(() =>
    rowsFromManifest.length > 0
      ? rowsFromManifest.map((row) => ({ ...row }))
      : presentation === "studio"
        ? []
        : [{ bindingName: "", namespaceId: "", access: "READ_ONLY" }],
  );
  const [touchedRows, setTouchedRows] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  const namespaces = namespacesQuery.data?.items ?? [];

  function syncManifest(nextRows: readonly AgentMemoryBindingRow[]) {
    props.onManifestChange(
      applyMemoryBindingsToManifestText(props.manifestText, nextRows),
    );
  }

  function updateRow(
    index: number,
    patch: Partial<AgentMemoryBindingRow>,
  ): void {
    setDraftRows((current) => {
      const next = current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      );
      syncManifest(next);
      return next;
    });
  }

  function addRow(): void {
    setDraftRows((current) => [
      ...current,
      { bindingName: "", namespaceId: "", access: "READ_ONLY" },
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
      <h2 className="section-title">Memory bindings</h2>
      <p className="muted">
        Select workspace memory namespaces with explicit access. READ_ONLY
        allows run-time reads only; READ_WRITE permits persistent writes through
        the memory gateway when the runtime supports them. Declarative agents
        currently use read snapshots only — writes are not executed
        automatically. Manage namespaces in{" "}
        <Link to="/memory">Memory Studio</Link>.
      </p>
      {namespacesQuery.isLoading ? (
        <p className="muted">Loading namespaces…</p>
      ) : null}
      {namespaces.length === 0 && !namespacesQuery.isLoading ? (
        <div className="agent-studio-capability-empty" role="status">
          <p className="muted">
            No memory namespaces exist yet. Create one in Memory, then return —
            your draft is preserved.
          </p>
          <Link className="button button-secondary" to="/memory">
            Open Memory
          </Link>
        </div>
      ) : null}
      {presentation === "studio" &&
      namespaces.length > 0 &&
      draftRows.length === 0 ? (
        <div className="agent-studio-capability-empty">
          <p className="muted">
            Add a memory binding when your agent needs persistent context.
          </p>
          <button
            type="button"
            className="button"
            disabled={props.disabled}
            onClick={addRow}
          >
            Add memory binding
          </button>
        </div>
      ) : null}
      {draftRows.map((row, index) => {
        const nameError = describeMemoryBindingNameError(row.bindingName);
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
            row.namespaceId.length > 0);
        return (
          <div className="filters" key={`memory-binding-${String(index)}`}>
            <div className="field">
              <label htmlFor={`memory-binding-name-${String(index)}`}>
                Binding name
              </label>
              <input
                id={`memory-binding-name-${String(index)}`}
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
              <label htmlFor={`memory-namespace-${String(index)}`}>
                Namespace
              </label>
              <select
                id={`memory-namespace-${String(index)}`}
                value={row.namespaceId}
                disabled={props.disabled}
                onChange={(event) =>
                  updateRow(index, { namespaceId: event.target.value })
                }
              >
                <option value="">Select namespace…</option>
                {namespaces.map((namespace) => (
                  <option key={namespace.id} value={namespace.id}>
                    {namespace.name} ({namespace.key})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`memory-access-${String(index)}`}>Access</label>
              <select
                id={`memory-access-${String(index)}`}
                value={row.access}
                disabled={props.disabled}
                onChange={(event) =>
                  updateRow(index, {
                    access: event.target.value as MemoryAccessMode,
                  })
                }
              >
                <option value="READ_ONLY">READ_ONLY</option>
                <option value="READ_WRITE">READ_WRITE</option>
              </select>
              <p className="muted">
                READ_WRITE does not bypass gateway authorization for persistent
                writes.
              </p>
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
          Add memory binding
        </button>
      ) : null}
    </section>
  );
}
