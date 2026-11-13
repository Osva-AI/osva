import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { useToolsCatalogQuery } from "../../hooks/use-tools-connectors";
import {
  summarizeToolVersion,
  toolVersionSelectLabel,
} from "../../lib/tool-resource-presentation";
import {
  applyToolBindingsToManifestText,
  collectToolBindingValidationIssues,
  describeToolBindingNameError,
  extractToolBindingRows,
  type AgentToolBindingRow,
} from "../../lib/agent-tool-bindings";
import {
  buildPreselectedBindingRows,
  isMcpToolVersion,
  lookupToolVersionInCatalog,
  validateToolVersionHandoff,
} from "../../lib/connector-agent-handoff";
import { parseWorkflowRunInputJson } from "../../lib/workflow-run-input";

export function ToolVersionBindingSelector(props: {
  readonly manifestText: string;
  readonly disabled?: boolean;
  readonly presentation?: "default" | "studio";
  readonly preselectedToolVersionIds?: readonly string[];
  readonly onManifestChange: (next: string) => void;
}) {
  const presentation = props.presentation ?? "default";
  const catalogQuery = useToolsCatalogQuery();
  const parsed = parseWorkflowRunInputJson(props.manifestText);
  const rowsFromManifest = parsed.ok
    ? extractToolBindingRows(parsed.value)
    : [];

  const [draftRows, setDraftRows] = useState<AgentToolBindingRow[]>(() =>
    rowsFromManifest.length > 0
      ? rowsFromManifest.map((row) => ({ ...row, toolId: "" }))
      : presentation === "studio"
        ? []
        : [{ bindingName: "", toolId: "", toolVersionId: "" }],
  );
  const [touchedRows, setTouchedRows] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const preselectionAppliedRef = useRef(false);

  const toolOptions = useMemo(
    () => catalogQuery.data?.map((entry) => entry.tool) ?? [],
    [catalogQuery.data],
  );

  const validationIssues = useMemo(
    () => collectToolBindingValidationIssues(draftRows, catalogQuery.data),
    [catalogQuery.data, draftRows],
  );

  function syncManifest(nextRows: readonly AgentToolBindingRow[]) {
    props.onManifestChange(
      applyToolBindingsToManifestText(props.manifestText, nextRows),
    );
  }

  function hydrateToolIds(
    rows: readonly AgentToolBindingRow[],
  ): AgentToolBindingRow[] {
    return rows.map((row) => {
      if (row.toolId.length > 0 || row.toolVersionId.length === 0) {
        return row;
      }
      const resolved = lookupToolVersionInCatalog(
        catalogQuery.data,
        row.toolVersionId,
      );
      if (resolved === undefined) {
        return row;
      }
      return { ...row, toolId: resolved.tool.id };
    });
  }

  useEffect(() => {
    if (
      preselectionAppliedRef.current ||
      props.preselectedToolVersionIds === undefined ||
      props.preselectedToolVersionIds.length === 0 ||
      catalogQuery.data === undefined
    ) {
      return;
    }
    const existingVersionIds = new Set(
      rowsFromManifest
        .map((row) => row.toolVersionId)
        .filter((id) => id.length > 0),
    );
    const { validated: catalogMatches } = validateToolVersionHandoff(
      props.preselectedToolVersionIds,
      catalogQuery.data,
    );
    const pending = catalogMatches.filter(
      (entry) => !existingVersionIds.has(entry.toolVersionId),
    );
    preselectionAppliedRef.current = true;
    if (pending.length === 0) {
      return;
    }
    const nextRows = buildPreselectedBindingRows(pending);
    setDraftRows((current) => {
      const emptyDraft =
        current.length === 0 ||
        current.every(
          (row) =>
            row.bindingName.trim().length === 0 &&
            row.toolId.length === 0 &&
            row.toolVersionId.length === 0,
        );
      const base = emptyDraft ? [] : current;
      const merged = [...base, ...nextRows];
      const hydrated = hydrateToolIds(merged);
      syncManifest(hydrated);
      return hydrated;
    });
  }, [catalogQuery.data, props.preselectedToolVersionIds, rowsFromManifest]);

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
      syncManifest(next);
      return next;
    });
    setTouchedRows((current) => {
      const rebuilt = new Set<number>();
      for (const value of current) {
        if (value < index) {
          rebuilt.add(value);
        } else if (value > index) {
          rebuilt.add(value - 1);
        }
      }
      return rebuilt;
    });
  }

  function markTouched(index: number): void {
    setTouchedRows((current) => new Set([...current, index]));
  }

  function rowHasDraftContent(row: AgentToolBindingRow): boolean {
    return (
      row.bindingName.trim().length > 0 ||
      row.toolId.length > 0 ||
      row.toolVersionId.length > 0
    );
  }

  return (
    <section className="panel" data-testid="tool-version-binding-selector">
      <h2 className="section-title">Tool bindings</h2>
      <p className="muted">
        Stage 3 — bind immutable ToolVersions by logical name. This configures
        the AgentVersion manifest only; Runtime authorization and execution
        (stages 4–5) occur on authorized Runs through ToolGateway.
      </p>
      <ul className="connector-binding-stage-legend muted">
        <li>Discovery — remote MCP metadata only</li>
        <li>Import — immutable ToolVersion registration</li>
        <li>Binding — manifest toolVersionBindings (this form)</li>
        <li>Authorization — ToolGateway on each Run</li>
        <li>Execution — Tool RunSteps on Run Detail</li>
      </ul>
      {validationIssues.length > 0 ? (
        <div
          className="connector-binding-validation"
          role="alert"
          data-testid="tool-binding-validation-issues"
        >
          <p className="field-error">
            Resolve binding issues before publishing:
          </p>
          <ul>
            {validationIssues.map((issue, index) => (
              <li key={`${issue.kind}-${String(index)}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {catalogQuery.isLoading ? (
        <p className="muted">Loading tool catalog…</p>
      ) : null}
      {toolOptions.length === 0 && !catalogQuery.isLoading ? (
        <div className="agent-studio-capability-empty" role="status">
          <p className="muted">
            {presentation === "studio"
              ? "No tools are available in this workspace yet. Connect an integration, then return here — your agent draft is preserved."
              : "No tools in this workspace yet. Register tools from Connectors or the control plane API."}
          </p>
          <Link className="button button-secondary" to="/tools/connectors">
            MCP connectors
          </Link>
          <Link className="button button-ghost" to="/tools">
            Tool registry
          </Link>
        </div>
      ) : null}
      {presentation === "studio" &&
      toolOptions.length > 0 &&
      draftRows.length === 0 ? (
        <div className="agent-studio-capability-empty">
          <p className="muted">
            Add a tool binding when you are ready. You will choose an immutable
            ToolVersion and binding name.
          </p>
          <button
            type="button"
            className="button"
            disabled={props.disabled}
            onClick={addRow}
          >
            Add tool binding
          </button>
        </div>
      ) : null}
      {draftRows.map((row, index) => {
        const catalogEntry = catalogQuery.data?.find(
          (entry) => entry.tool.id === row.toolId,
        );
        const versions = catalogEntry?.versions ?? [];
        const selectedVersion = versions.find(
          (v) => v.id === row.toolVersionId,
        );
        const mcpVersion =
          selectedVersion !== undefined && isMcpToolVersion(selectedVersion)
            ? selectedVersion
            : undefined;
        const nameError = describeToolBindingNameError(row.bindingName);
        const showNameError =
          nameError !== undefined &&
          (presentation !== "studio" ||
            touchedRows.has(index) ||
            rowHasDraftContent(row));
        const duplicateName =
          row.bindingName.trim().length > 0 &&
          draftRows.filter(
            (other) =>
              other.bindingName.trim() === row.bindingName.trim() &&
              other !== row,
          ).length > 0;
        const versionSummary =
          selectedVersion !== undefined
            ? summarizeToolVersion(selectedVersion)
            : undefined;
        return (
          <div
            className="filters connector-tool-binding-row"
            key={`tool-binding-${String(index)}`}
          >
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
                onBlur={() => markTouched(index)}
              />
              {showNameError ? (
                <span className="field-error">{nameError}</span>
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
                    {toolVersionSelectLabel(version)}
                  </option>
                ))}
              </select>
              {row.toolId.length > 0 ? (
                <p className="muted">
                  <Link to={`/tools/${row.toolId}`}>Open tool detail</Link>
                </p>
              ) : null}
            </div>
            {selectedVersion !== undefined && versionSummary !== undefined ? (
              <div
                className="connector-tool-binding-meta panel nested"
                data-testid={`tool-binding-meta-${String(index)}`}
              >
                <p>
                  <strong>{versionSummary.typeLabel}</strong> ·{" "}
                  {versionSummary.capability}
                </p>
                {mcpVersion !== undefined ? (
                  <>
                    <dl className="meta-list">
                      <div>
                        <dt>Remote MCP tool</dt>
                        <dd className="mono">
                          {mcpVersion.mcp.remoteToolName}
                        </dd>
                      </div>
                      <div>
                        <dt>ConnectorVersion</dt>
                        <dd className="mono">
                          {mcpVersion.mcp.connectorVersionId}
                        </dd>
                      </div>
                      <div>
                        <dt>Immutable version</dt>
                        <dd>v{String(mcpVersion.version)}</dd>
                      </div>
                    </dl>
                    <p className="muted">
                      Catalog read-only vs mutation lists are not verified for
                      this workspace import. ToolGateway enforces authorization
                      at execution time.
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              className="button"
              disabled={
                props.disabled ||
                (presentation !== "studio" && draftRows.length <= 1)
              }
              onClick={() => removeRow(index)}
            >
              Remove
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
          Add tool binding
        </button>
      ) : null}
    </section>
  );
}
