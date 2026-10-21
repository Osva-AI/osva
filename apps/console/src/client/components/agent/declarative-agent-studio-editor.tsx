import { useMemo } from "react";
import {
  applyDeclarativeStudioPatch,
  describeDeclarativeManifestValidation,
  extractDeclarativeStudioFields,
  manifestToText,
  parseManifestRecord,
  type DeclarativeStudioFields,
  type ManifestValidationView,
} from "../../lib/declarative-agent-manifest";
import { ModelProfileVersionSelector } from "./model-profile-version-selector";
import { ToolVersionBindingSelector } from "./tool-version-binding-selector";
import { KnowledgeBindingSelector } from "./knowledge-binding-selector";
import { MemoryBindingSelector } from "./memory-binding-selector";
import { extractKnowledgeBindingRows } from "../../lib/agent-knowledge-bindings";
import { extractMemoryBindingRows } from "../../lib/agent-memory-bindings";

export type AgentStudioEditorMode = "guided" | "advanced";

export function DeclarativeAgentStudioEditor(props: {
  readonly manifestText: string;
  readonly disabled?: boolean;
  readonly mode: AgentStudioEditorMode;
  readonly onManifestTextChange: (next: string) => void;
  readonly onModeChange?: (mode: AgentStudioEditorMode) => void;
  readonly showManifestKeyFields?: boolean;
  readonly validation?: ManifestValidationView;
}) {
  const parsed = parseManifestRecord(props.manifestText);
  const fields = parsed.ok
    ? extractDeclarativeStudioFields(parsed.value)
    : extractDeclarativeStudioFields(undefined);
  const validation =
    props.validation ??
    (parsed.ok
      ? describeDeclarativeManifestValidation(parsed.value)
      : {
          ok: false,
          messages: parsed.ok ? [] : [parsed.message],
          fieldErrors: {},
        });

  function patch(patch: Partial<DeclarativeStudioFields>): void {
    if (!parsed.ok) {
      return;
    }
    const next = applyDeclarativeStudioPatch(parsed.value, patch);
    props.onManifestTextChange(manifestToText(next));
  }

  const modeToggle = props.onModeChange ? (
    <div className="toolbar">
      <button
        type="button"
        className={`button${props.mode === "guided" ? " primary" : ""}`}
        disabled={props.disabled}
        onClick={() => props.onModeChange?.("guided")}
      >
        Guided
      </button>
      <button
        type="button"
        className={`button${props.mode === "advanced" ? " primary" : ""}`}
        disabled={props.disabled}
        onClick={() => props.onModeChange?.("advanced")}
      >
        Advanced JSON
      </button>
    </div>
  ) : null;

  const guided = (
    <>
      {props.showManifestKeyFields ? (
        <div className="filters">
          <div className="field">
            <label htmlFor="studio-manifest-name">Display name</label>
            <input
              id="studio-manifest-name"
              value={fields.manifestName}
              disabled={props.disabled}
              onChange={(event) => patch({ manifestName: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="studio-manifest-key">Agent key</label>
            <input
              id="studio-manifest-key"
              value={fields.manifestKey}
              disabled={props.disabled}
              onChange={(event) => patch({ manifestKey: event.target.value })}
            />
            <p className="muted">
              Workspace-unique identifier used in APIs and workflows.
            </p>
          </div>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="studio-instructions">Instructions</label>
        <textarea
          id="studio-instructions"
          rows={8}
          value={fields.instructions}
          disabled={props.disabled}
          onChange={(event) => patch({ instructions: event.target.value })}
          aria-invalid={validation.fieldErrors.instructions !== undefined}
        />
        <p className="muted">
          Tell the agent its role, tone, and boundaries. These instructions are
          trusted configuration — not end-user Run input.
        </p>
        {validation.fieldErrors.instructions !== undefined ? (
          <p className="error-inline" role="alert">
            {validation.fieldErrors.instructions}
          </p>
        ) : null}
      </div>

      <ModelProfileVersionSelector
        value={fields.modelProfileVersionId}
        disabled={props.disabled}
        onChange={(selection) => {
          if (selection === undefined) {
            patch({ modelProfileVersionId: "" });
            return;
          }
          patch({ modelProfileVersionId: selection.modelProfileVersionId });
        }}
      />
      {validation.fieldErrors.model !== undefined ? (
        <p className="error-inline" role="alert">
          {validation.fieldErrors.model}
        </p>
      ) : null}

      <ToolVersionBindingSelector
        manifestText={props.manifestText}
        disabled={props.disabled}
        onManifestChange={props.onManifestTextChange}
      />
      {validation.fieldErrors.tools !== undefined ? (
        <p className="error-inline" role="alert">
          {validation.fieldErrors.tools}
        </p>
      ) : null}

      <KnowledgeBindingSelector
        manifestText={props.manifestText}
        disabled={props.disabled}
        onManifestChange={props.onManifestTextChange}
      />
      <MemoryBindingSelector
        manifestText={props.manifestText}
        disabled={props.disabled}
        onManifestChange={props.onManifestTextChange}
      />

      <details className="panel">
        <summary>Execution and limits</summary>
        <div className="filters">
          <div className="field">
            <label htmlFor="studio-max-model">Max model calls</label>
            <input
              id="studio-max-model"
              inputMode="numeric"
              value={fields.maxModelInvocations}
              disabled={props.disabled}
              onChange={(event) =>
                patch({ maxModelInvocations: event.target.value })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="studio-max-tool">Max tool calls</label>
            <input
              id="studio-max-tool"
              inputMode="numeric"
              value={fields.maxToolInvocations}
              disabled={props.disabled}
              onChange={(event) =>
                patch({ maxToolInvocations: event.target.value })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="studio-max-output">
              Max output tokens (optional)
            </label>
            <input
              id="studio-max-output"
              inputMode="numeric"
              value={fields.maxOutputTokens}
              disabled={props.disabled}
              onChange={(event) =>
                patch({ maxOutputTokens: event.target.value })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="studio-timeout">Timeout (ms)</label>
            <input
              id="studio-timeout"
              inputMode="numeric"
              value={fields.timeoutMs}
              disabled={props.disabled}
              onChange={(event) => patch({ timeoutMs: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="studio-max-attempts">Max attempts</label>
            <input
              id="studio-max-attempts"
              inputMode="numeric"
              value={fields.maxAttempts}
              disabled={props.disabled}
              onChange={(event) => patch({ maxAttempts: event.target.value })}
            />
          </div>
        </div>
        {validation.fieldErrors.budgets !== undefined ||
        validation.fieldErrors.execution !== undefined ? (
          <p className="error-inline" role="alert">
            {validation.fieldErrors.budgets ?? validation.fieldErrors.execution}
          </p>
        ) : null}

        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={fields.useCustomOutputSchema}
              disabled={props.disabled}
              onChange={(event) =>
                patch({ useCustomOutputSchema: event.target.checked })
              }
            />{" "}
            Customize output JSON Schema (advanced)
          </label>
          {fields.useCustomOutputSchema ? (
            <textarea
              rows={8}
              value={fields.outputSchemaText}
              disabled={props.disabled}
              spellCheck={false}
              onChange={(event) =>
                patch({ outputSchemaText: event.target.value })
              }
              aria-invalid={validation.fieldErrors.outputSchema !== undefined}
            />
          ) : (
            <p className="muted">
              Default allows any JSON object in the Run output.
            </p>
          )}
          {validation.fieldErrors.outputSchema !== undefined ? (
            <p className="error-inline" role="alert">
              {validation.fieldErrors.outputSchema}
            </p>
          ) : null}
        </div>
      </details>
    </>
  );

  const advancedJson = (
    <div className="field">
      <label htmlFor="studio-manifest-json">Manifest (JSON)</label>
      <textarea
        id="studio-manifest-json"
        rows={22}
        value={props.manifestText}
        spellCheck={false}
        disabled={props.disabled}
        onChange={(event) => props.onManifestTextChange(event.target.value)}
      />
      {!parsed.ok ? (
        <p className="error-inline" role="alert">
          {parsed.message}
        </p>
      ) : null}
    </div>
  );

  const summaryMessages = useMemo(
    () => validation.messages.slice(0, 6),
    [validation.messages],
  );

  return (
    <div className="agent-studio-editor">
      {modeToggle}
      {props.mode === "guided" ? guided : null}
      {props.mode === "advanced" ? (
        <>
          {guided}
          {advancedJson}
        </>
      ) : null}
      {!validation.ok && summaryMessages.length > 0 ? (
        <div className="panel" role="alert">
          <h2 className="section-title">Validation</h2>
          <ul>
            {summaryMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function AgentVersionReviewPanel(props: {
  readonly manifestText: string;
}) {
  const parsed = parseManifestRecord(props.manifestText);
  if (!parsed.ok) {
    return (
      <p className="error-inline" role="alert">
        {parsed.message}
      </p>
    );
  }
  const fields = extractDeclarativeStudioFields(parsed.value);
  const validation = describeDeclarativeManifestValidation(parsed.value);
  return (
    <section className="panel">
      <h2 className="section-title">Review before publishing</h2>
      <p className="muted">
        Publishing saves an immutable AgentVersion. Model and tool calls during
        a Run may incur provider cost.
      </p>
      <dl className="meta-grid">
        <div>
          <dt>Name</dt>
          <dd>{fields.manifestName}</dd>
        </div>
        <div>
          <dt>Key</dt>
          <dd className="mono">{fields.manifestKey}</dd>
        </div>
        <div>
          <dt>Model version</dt>
          <dd className="mono">
            {fields.modelProfileVersionId.length > 0
              ? fields.modelProfileVersionId
              : "Not selected"}
          </dd>
        </div>
        <div>
          <dt>Tool bindings</dt>
          <dd>
            {isRecord(parsed.value.tools)
              ? Object.keys(parsed.value.tools).join(", ") || "None"
              : "None"}
          </dd>
        </div>
        <div>
          <dt>Knowledge bindings</dt>
          <dd>
            {extractKnowledgeBindingRows(parsed.value)
              .map(
                (row) =>
                  `${row.bindingName} → ${row.knowledgeIndexIds.join(", ")}`,
              )
              .join("; ") || "None"}
          </dd>
        </div>
        <div>
          <dt>Memory bindings</dt>
          <dd>
            {extractMemoryBindingRows(parsed.value)
              .map(
                (row) =>
                  `${row.bindingName} → ${row.namespaceId} (${row.access})`,
              )
              .join("; ") || "None"}
          </dd>
        </div>
        <div>
          <dt>Model call budget</dt>
          <dd>{fields.maxModelInvocations}</dd>
        </div>
        <div>
          <dt>Tool call budget</dt>
          <dd>{fields.maxToolInvocations}</dd>
        </div>
      </dl>
      <p className="muted">
        Instructions preview:{" "}
        {fields.instructions.trim().length > 0
          ? fields.instructions.trim().slice(0, 240)
          : "(empty)"}
        {fields.instructions.length > 240 ? "…" : ""}
      </p>
      {!validation.ok ? (
        <p className="error-inline" role="alert">
          Fix validation issues before publishing.
        </p>
      ) : (
        <p className="muted">Configuration passes local manifest validation.</p>
      )}
    </section>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
