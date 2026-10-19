import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  useToolsCatalogQuery,
  type ToolVersionResource,
} from "../../hooks/use-tools-connectors";
import {
  applyToolBindingsToManifestText,
  describeToolBindingNameError,
  extractToolBindingRows,
  type AgentToolBindingRow,
} from "../../lib/agent-tool-bindings";
import { parseWorkflowRunInputJson } from "../../lib/workflow-run-input";

function versionLabel(version: ToolVersionResource): string {
  if (version.type === "INTERNAL") {
    return `v${String(version.version)} · INTERNAL · ${version.implementation}`;
  }
  const remote = version.mcp.remoteToolName;
  return `v${String(version.version)} · MCP · ${remote}`;
}

export function ToolVersionBindingSelector(props: {
  readonly manifestText: string;
  readonly disabled?: boolean;
  readonly onManifestChange: (next: string) => void;
}) {
  const catalogQuery = useToolsCatalogQuery();
  const parsed = parseWorkflowRunInputJson(props.manifestText);
  const rowsFromManifest = parsed.ok
    ? extractToolBindingRows(parsed.value)
    : [];

  const [draftRows, setDraftRows] = useState<AgentToolBindingRow[]>(() =>
    rowsFromManifest.length > 0
      ? rowsFromManifest.map((row) => ({ ...row, toolId: "" }))
      : [{ bindingName: "", toolId: "", toolVersionId: "" }],
  );

  const toolOptions = useMemo(
    () => catalogQuery.data?.map((entry) => entry.tool) ?? [],
    [catalogQuery.data],
  );

  function syncManifest(nextRows: readonly AgentToolBindingRow[]) {
    props.onManifestChange(
      applyToolBindingsToManifestText(props.manifestText, nextRows),
    );
  }

  function updateRow(index: number, patch: Partial<AgentToolBindingRow>): void {
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
      { bindingName: "", toolId: "", toolVersionId: "" },
    ]);
  }

  function removeRow(index: number): void {
    setDraftRows((current) => {
      const next = current.filter((_row, rowIndex) => rowIndex !== index);
      const normalized =
        next.length === 0
          ? [{ bindingName: "", toolId: "", toolVersionId: "" }]
          : next;
      syncManifest(normalized);
      return normalized;
    });
  }

  return (
    <section className="panel">
      <h2 className="section-title">Tool bindings</h2>
      <p className="muted">
        Bind immutable ToolVersions by logical name. Importing or discovering
        tools registers capabilities only — execution still flows through
        ToolGateway at run time.
      </p>
      {catalogQuery.isLoading ? (
        <p className="muted">Loading tool catalog…</p>
      ) : null}
      {toolOptions.length === 0 && !catalogQuery.isLoading ? (
        <p className="muted">
          No tools in this workspace yet. Register tools from{" "}
          <Link to="/tools/connectors">Connectors</Link> or the control plane
          API.
        </p>
      ) : null}
      {draftRows.map((row, index) => {
        const catalogEntry = catalogQuery.data?.find(
          (entry) => entry.tool.id === row.toolId,
        );
        const versions = catalogEntry?.versions ?? [];
        const nameError = describeToolBindingNameError(row.bindingName);
        const duplicateName =
          row.bindingName.trim().length > 0 &&
          draftRows.filter(
            (other) =>
              other.bindingName.trim() === row.bindingName.trim() &&
              other !== row,
          ).length > 0;
        return (
          <div className="filters" key={`tool-binding-${String(index)}`}>
            <div className="field">
              <label htmlFor={`tool-binding-name-${String(index)}`}>
                Binding name
              </label>
              <input
                id={`tool-binding-name-${String(index)}`}
                value={row.bindingName}
                disabled={props.disabled}
                onChange={(event) =>
                  updateRow(index, { bindingName: event.target.value })
                }
              />
              {nameError !== undefined ? (
                <span className="muted">{nameError}</span>
              ) : null}
              {duplicateName ? (
                <span className="muted">Duplicate binding name.</span>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor={`tool-binding-tool-${String(index)}`}>Tool</label>
              <select
                id={`tool-binding-tool-${String(index)}`}
                value={row.toolId}
                disabled={props.disabled || catalogQuery.isLoading}
                onChange={(event) =>
                  updateRow(index, {
                    toolId: event.target.value,
                    toolVersionId: "",
                  })
                }
              >
                <option value="">Select tool…</option>
                {toolOptions.map((tool) => (
                  <option key={tool.id} value={tool.id}>
                    {tool.name} ({tool.key})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`tool-binding-version-${String(index)}`}>
                ToolVersion
              </label>
              <select
                id={`tool-binding-version-${String(index)}`}
                value={row.toolVersionId}
                disabled={
                  props.disabled ||
                  row.toolId.length === 0 ||
                  versions.length === 0
                }
                onChange={(event) =>
                  updateRow(index, { toolVersionId: event.target.value })
                }
              >
                <option value="">Select version…</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {versionLabel(version)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="button"
              disabled={props.disabled || draftRows.length <= 1}
              onClick={() => removeRow(index)}
            >
              Remove
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
        Add tool binding
      </button>
    </section>
  );
}
