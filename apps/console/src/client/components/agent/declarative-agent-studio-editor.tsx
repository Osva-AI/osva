import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  applyDeclarativeStudioPatch,
  describeDeclarativeManifestValidation,
  extractDeclarativeStudioFields,
  manifestToText,
  parseManifestRecord,
  type DeclarativeStudioFields,
  type ManifestValidationView,
} from "../../lib/declarative-agent-manifest";
import {
  AGENT_STUDIO_SECTIONS,
  firstSectionWithError,
  sectionHasFieldError,
  type AgentStudioSectionId,
} from "../../lib/agent-studio-sections";
import {
  describeExecutionAssuranceNote,
  describeManifestAssurance,
} from "../../lib/agent-studio-assurance";
import { TextAreaField } from "../ui/field";
import { InlineMessage } from "../ui/inline-message";
import { ModelProfileVersionSelector } from "./model-profile-version-selector";
import { ToolVersionBindingSelector } from "./tool-version-binding-selector";
import { KnowledgeBindingSelector } from "./knowledge-binding-selector";
import { MemoryBindingSelector } from "./memory-binding-selector";
import { extractKnowledgeBindingRows } from "../../lib/agent-knowledge-bindings";
import { extractMemoryBindingRows } from "../../lib/agent-memory-bindings";

export type AgentStudioEditorMode = "guided" | "advanced";

type ExecutionDraftFields = Pick<
  DeclarativeStudioFields,
  | "maxModelInvocations"
  | "maxToolInvocations"
  | "maxOutputTokens"
  | "timeoutMs"
  | "maxAttempts"
>;

export function DeclarativeAgentStudioEditor(props: {
  readonly manifestText: string;
  readonly disabled?: boolean;
  readonly mode: AgentStudioEditorMode;
  readonly layoutVariant?: "sections" | "advanced-only";
  readonly onManifestTextChange: (next: string) => void;
  readonly onModeChange?: (mode: AgentStudioEditorMode) => void;
  readonly showManifestKeyFields?: boolean;
  readonly validation?: ManifestValidationView;
}) {
  const layoutVariant = props.layoutVariant ?? "sections";
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

  const assurance = describeManifestAssurance(props.manifestText);
  const [activeSection, setActiveSection] =
    useState<AgentStudioSectionId>("identity");
  const [executionDraft, setExecutionDraft] = useState<ExecutionDraftFields>(
    () => pickExecutionDraft(fields),
  );

  useEffect(() => {
    setExecutionDraft(pickExecutionDraft(fields));
  }, [props.manifestText]);

  function patch(patch: Partial<DeclarativeStudioFields>): void {
    if (!parsed.ok) {
      return;
    }
    const next = applyDeclarativeStudioPatch(parsed.value, patch);
    props.onManifestTextChange(manifestToText(next));
  }

  function commitExecutionDraft(): void {
    patch(executionDraft);
  }

  function scrollToSection(sectionId: AgentStudioSectionId): void {
    setActiveSection(sectionId);
    document
      .getElementById(`agent-studio-section-${sectionId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const modeToggle =
    props.onModeChange && layoutVariant === "sections" ? (
      <div className="toolbar agent-studio-mode-toggle">
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

  const invalidJsonGuidance =
    !parsed.ok && props.mode === "guided" ? (
      <InlineMessage tone="warning" title="Manifest JSON is invalid">
        Guided editing is paused so your raw draft is preserved. Switch to{" "}
        <button
          type="button"
          className="button"
          onClick={() => props.onModeChange?.("advanced")}
        >
          Advanced JSON
        </button>{" "}
        to fix syntax, then return to Guided.
      </InlineMessage>
    ) : null;

  const identitySection = (
    <section
      id="agent-studio-section-identity"
      className="panel agent-studio-section"
      aria-labelledby="agent-studio-identity-title"
    >
      <h2 className="section-title" id="agent-studio-identity-title">
        Identity & instructions
      </h2>
      <p className="muted agent-studio-section-intro">
        Required fields for every declarative agent. Instructions are trusted
        configuration — they are not end-user Run input.
      </p>

      {props.showManifestKeyFields ? (
        <div className="filters">
          <div className="field">
            <label htmlFor="studio-manifest-name" className="field-label">
              Display name
            </label>
            <input
              id="studio-manifest-name"
              className="ui-control"
              value={fields.manifestName}
              disabled={props.disabled || !parsed.ok}
              onChange={(event) => patch({ manifestName: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="studio-manifest-key" className="field-label">
              Agent key
              <span className="field-badge field-badge-required">Required</span>
            </label>
            <input
              id="studio-manifest-key"
              className="ui-control"
              value={fields.manifestKey}
              disabled={props.disabled || !parsed.ok}
              onChange={(event) => patch({ manifestKey: event.target.value })}
            />
            <p className="field-hint">
              Workspace-unique identifier used in APIs and workflows.
            </p>
          </div>
        </div>
      ) : null}

      <TextAreaField
        id="studio-instructions"
        label="Instructions"
        required
        rows={10}
        value={fields.instructions}
        disabled={props.disabled || !parsed.ok}
        error={validation.fieldErrors.instructions}
        hint="Purpose: what this agent is for. Behavior: how it should respond. Boundaries: topics or actions to refuse. All of this is stored in the single canonical instructions field."
        onChange={(event) => patch({ instructions: event.target.value })}
      />
    </section>
  );

  const modelSection = (
    <section
      id="agent-studio-section-model"
      className="panel agent-studio-section"
      aria-labelledby="agent-studio-model-title"
    >
      <h2 className="section-title" id="agent-studio-model-title">
        Model
      </h2>
      <p className="muted agent-studio-section-intro">
        Bind an immutable ModelProfileVersion. The manifest stores the exact
        version ID — OSVA never silently upgrades to latest.
      </p>
      <ModelProfileVersionSelector
        value={fields.modelProfileVersionId}
        disabled={props.disabled || !parsed.ok}
        onChange={(selection) => {
          if (selection === undefined) {
            patch({ modelProfileVersionId: "" });
            return;
          }
          patch({ modelProfileVersionId: selection.modelProfileVersionId });
        }}
      />
      {validation.fieldErrors.model !== undefined ? (
        <p className="field-error" role="alert">
          {validation.fieldErrors.model}
        </p>
      ) : null}
      <p className="muted">
        Missing profiles or connections?{" "}
        <Link to="/models/connections">Configure model connections</Link> and{" "}
        <Link to="/models">publish a model profile version</Link>. Registering a
        connection does not prove provider calls succeed until a Run executes.
      </p>
    </section>
  );

  const toolsSection = (
    <section
      id="agent-studio-section-tools"
      className="panel agent-studio-section"
      aria-labelledby="agent-studio-tools-title"
    >
      <h2 className="section-title" id="agent-studio-tools-title">
        Tools
        <span className="field-badge field-badge-optional">Optional</span>
      </h2>
      <p className="muted agent-studio-section-intro">
        Attach immutable ToolVersions with logical binding names. Permissions
        follow existing ToolGateway policy — prompts cannot grant access.
      </p>
      <ToolVersionBindingSelector
        manifestText={props.manifestText}
        disabled={props.disabled || !parsed.ok}
        onManifestChange={props.onManifestTextChange}
      />
      {validation.fieldErrors.tools !== undefined ? (
        <p className="field-error" role="alert">
          {validation.fieldErrors.tools}
        </p>
      ) : null}
    </section>
  );

  const knowledgeSection = (
    <section
      id="agent-studio-section-knowledge"
      className="panel agent-studio-section"
      aria-labelledby="agent-studio-knowledge-title"
    >
      <h2 className="section-title" id="agent-studio-knowledge-title">
        Knowledge
        <span className="field-badge field-badge-optional">Optional</span>
      </h2>
      <KnowledgeBindingSelector
        manifestText={props.manifestText}
        disabled={props.disabled || !parsed.ok}
        onManifestChange={props.onManifestTextChange}
      />
    </section>
  );

  const memorySection = (
    <section
      id="agent-studio-section-memory"
      className="panel agent-studio-section"
      aria-labelledby="agent-studio-memory-title"
    >
      <h2 className="section-title" id="agent-studio-memory-title">
        Memory
        <span className="field-badge field-badge-optional">Optional</span>
      </h2>
      <MemoryBindingSelector
        manifestText={props.manifestText}
        disabled={props.disabled || !parsed.ok}
        onManifestChange={props.onManifestTextChange}
      />
    </section>
  );

  const executionSection = (
    <section
      id="agent-studio-section-execution"
      className="panel agent-studio-section"
      aria-labelledby="agent-studio-execution-title"
    >
      <h2 className="section-title" id="agent-studio-execution-title">
        Execution settings
      </h2>
      <p className="muted agent-studio-section-intro">
        Technical limits for Runs. Values commit when you leave a field so
        partial numbers are not silently rewritten while typing.
      </p>
      <div className="filters">
        <div className="field">
          <label htmlFor="studio-max-model">Max model calls</label>
          <input
            id="studio-max-model"
            className="ui-control"
            inputMode="numeric"
            value={executionDraft.maxModelInvocations}
            disabled={props.disabled || !parsed.ok}
            onChange={(event) =>
              setExecutionDraft((current) => ({
                ...current,
                maxModelInvocations: event.target.value,
              }))
            }
            onBlur={commitExecutionDraft}
          />
        </div>
        <div className="field">
          <label htmlFor="studio-max-tool">Max tool calls</label>
          <input
            id="studio-max-tool"
            className="ui-control"
            inputMode="numeric"
            value={executionDraft.maxToolInvocations}
            disabled={props.disabled || !parsed.ok}
            onChange={(event) =>
              setExecutionDraft((current) => ({
                ...current,
                maxToolInvocations: event.target.value,
              }))
            }
            onBlur={commitExecutionDraft}
          />
        </div>
        <div className="field">
          <label htmlFor="studio-max-output">
            Max output tokens
            <span className="field-badge field-badge-optional">Optional</span>
          </label>
          <input
            id="studio-max-output"
            className="ui-control"
            inputMode="numeric"
            value={executionDraft.maxOutputTokens}
            disabled={props.disabled || !parsed.ok}
            onChange={(event) =>
              setExecutionDraft((current) => ({
                ...current,
                maxOutputTokens: event.target.value,
              }))
            }
            onBlur={commitExecutionDraft}
          />
        </div>
        <div className="field">
          <label htmlFor="studio-timeout">Timeout (ms)</label>
          <input
            id="studio-timeout"
            className="ui-control"
            inputMode="numeric"
            value={executionDraft.timeoutMs}
            disabled={props.disabled || !parsed.ok}
            onChange={(event) =>
              setExecutionDraft((current) => ({
                ...current,
                timeoutMs: event.target.value,
              }))
            }
            onBlur={commitExecutionDraft}
          />
        </div>
        <div className="field">
          <label htmlFor="studio-max-attempts">Max attempts</label>
          <input
            id="studio-max-attempts"
            className="ui-control"
            inputMode="numeric"
            value={executionDraft.maxAttempts}
            disabled={props.disabled || !parsed.ok}
            onChange={(event) =>
              setExecutionDraft((current) => ({
                ...current,
                maxAttempts: event.target.value,
              }))
            }
            onBlur={commitExecutionDraft}
          />
        </div>
      </div>
      {validation.fieldErrors.budgets !== undefined ||
      validation.fieldErrors.execution !== undefined ? (
        <p className="field-error" role="alert">
          {validation.fieldErrors.budgets ?? validation.fieldErrors.execution}
        </p>
      ) : null}

      <details className="agent-studio-advanced-details">
        <summary>Output JSON Schema (advanced)</summary>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={fields.useCustomOutputSchema}
              disabled={props.disabled || !parsed.ok}
              onChange={(event) =>
                patch({ useCustomOutputSchema: event.target.checked })
              }
            />{" "}
            Customize output schema
          </label>
          {fields.useCustomOutputSchema ? (
            <textarea
              className="ui-control ui-control-textarea"
              rows={8}
              value={fields.outputSchemaText}
              disabled={props.disabled || !parsed.ok}
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
            <p className="field-error" role="alert">
              {validation.fieldErrors.outputSchema}
            </p>
          ) : null}
        </div>
      </details>
    </section>
  );

  const advancedJsonSection = (
    <section
      id="agent-studio-section-advanced"
      className="panel agent-studio-section"
      aria-labelledby="agent-studio-advanced-title"
    >
      <h2 className="section-title" id="agent-studio-advanced-title">
        Manifest JSON
      </h2>
      <p className="muted agent-studio-section-intro">
        Same canonical draft as guided fields. Unknown valid fields are
        preserved. Invalid JSON blocks publishing until corrected.
      </p>
      <TextAreaField
        id="studio-manifest-json"
        label="AgentVersion manifest"
        rows={22}
        value={props.manifestText}
        spellCheck={false}
        disabled={props.disabled}
        error={parsed.ok ? undefined : parsed.message}
        onChange={(event) => props.onManifestTextChange(event.target.value)}
      />
    </section>
  );

  const guidedSections =
    props.mode === "guided" && layoutVariant === "sections" ? (
      <>
        {invalidJsonGuidance}
        {identitySection}
        {modelSection}
        {toolsSection}
        {knowledgeSection}
        {memorySection}
        {executionSection}
      </>
    ) : null;

  const advancedSections =
    props.mode === "advanced" || layoutVariant === "advanced-only" ? (
      <>
        {!parsed.ok ? (
          <InlineMessage tone="error" title="JSON syntax invalid">
            {parsed.message} Switch back to Guided after syntax is valid to use
            form fields.
          </InlineMessage>
        ) : (
          <InlineMessage tone="info" title="Advanced JSON is authoritative">
            Edits here update the same draft as Guided. Switch modes anytime —
            configuration is not reset.
          </InlineMessage>
        )}
        {advancedJsonSection}
      </>
    ) : null;

  const summaryMessages = useMemo(
    () => validation.messages.slice(0, 8),
    [validation.messages],
  );

  const errorSectionId = firstSectionWithError(validation.fieldErrors);

  if (layoutVariant === "advanced-only") {
    return (
      <div className="agent-studio-editor agent-studio-editor-advanced-only">
        <div className="agent-studio-main stack">{advancedSections}</div>
      </div>
    );
  }

  return (
    <div className="agent-studio-editor">
      <div className="agent-studio-layout">
        <nav
          className="agent-studio-nav panel"
          aria-label="Agent configuration sections"
        >
          <p className="agent-studio-nav-title">Sections</p>
          <ul className="agent-studio-nav-list">
            {AGENT_STUDIO_SECTIONS.filter(
              (section) =>
                section.id !== "advanced" || props.mode === "advanced",
            ).map((section) => {
              const hasError = sectionHasFieldError(
                section,
                validation.fieldErrors,
              );
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    className={`agent-studio-nav-link${activeSection === section.id ? " is-active" : ""}${hasError ? " has-error" : ""}`}
                    onClick={() => scrollToSection(section.id)}
                  >
                    {section.title}
                    {hasError ? (
                      <span className="agent-studio-nav-error">Issue</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="agent-studio-main stack">
          <div className="agent-studio-status panel">
            {modeToggle}
            <InlineMessage
              tone={
                assurance.level === "draft-valid"
                  ? "success"
                  : assurance.level === "syntax-invalid"
                    ? "error"
                    : "warning"
              }
              title={assurance.title}
            >
              {assurance.detail}
            </InlineMessage>
            <p className="muted">{describeExecutionAssuranceNote()}</p>
          </div>

          {guidedSections}
          {advancedSections}

          {!validation.ok && summaryMessages.length > 0 ? (
            <div className="panel" role="alert" id="agent-studio-validation">
              <h2 className="section-title">Validation summary</h2>
              <ul className="agent-studio-validation-list">
                {summaryMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
              {errorSectionId !== undefined ? (
                <button
                  type="button"
                  className="button"
                  onClick={() => scrollToSection(errorSectionId)}
                >
                  Jump to first issue
                </button>
              ) : null}
            </div>
          ) : validation.ok ? (
            <p className="muted" role="status">
              Ready for review when model and instructions are complete.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function AgentVersionReviewPanel(props: {
  readonly manifestText: string;
  readonly variant?: "default" | "studio";
}) {
  const parsed = parseManifestRecord(props.manifestText);
  const assurance = describeManifestAssurance(props.manifestText);
  if (!parsed.ok) {
    return (
      <InlineMessage tone="error" title="Cannot review yet">
        {parsed.message}
      </InlineMessage>
    );
  }
  const fields = extractDeclarativeStudioFields(parsed.value);
  const validation = describeDeclarativeManifestValidation(parsed.value);
  const variant = props.variant ?? "default";
  const toolBindings = isRecord(parsed.value.tools)
    ? Object.keys(parsed.value.tools).join(", ") || "None"
    : "None";
  const knowledgeBindings =
    extractKnowledgeBindingRows(parsed.value)
      .map((row) => `${row.bindingName} → ${row.knowledgeIndexIds.join(", ")}`)
      .join("; ") || "None";
  const memoryBindings =
    extractMemoryBindingRows(parsed.value)
      .map((row) => `${row.bindingName} → ${row.namespaceId} (${row.access})`)
      .join("; ") || "None";
  const instructionsPreview =
    fields.instructions.trim().length > 0
      ? fields.instructions.trim().slice(0, 320)
      : "(empty)";

  return (
    <section className="panel agent-studio-review">
      <h2 className="section-title">Review before publishing</h2>
      {variant === "default" ? (
        <InlineMessage
          tone={validation.ok ? "info" : "warning"}
          title={assurance.title}
        >
          {assurance.detail}
        </InlineMessage>
      ) : null}
      <ul className="muted agent-studio-review-notes">
        <li>
          Publishing creates a new immutable AgentVersion. Earlier versions stay
          unchanged.
        </li>
        <li>Publishing does not execute the agent or call a model.</li>
        <li>
          Model and tool usage during Runs may incur external provider cost.
        </li>
      </ul>
      {variant === "studio" ? (
        <>
          <dl className="meta-grid agent-studio-review-primary">
            <div>
              <dt>Name</dt>
              <dd>{fields.manifestName}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>
                {fields.modelProfileVersionId.length > 0
                  ? "Workspace model version selected"
                  : "Not selected"}
              </dd>
            </div>
            <div>
              <dt>Tools</dt>
              <dd>{toolBindings}</dd>
            </div>
            <div>
              <dt>Knowledge</dt>
              <dd>{knowledgeBindings}</dd>
            </div>
            <div>
              <dt>Memory</dt>
              <dd>{memoryBindings}</dd>
            </div>
          </dl>
          <p className="muted agent-studio-review-instructions">
            <strong>Instructions</strong> — {instructionsPreview}
            {fields.instructions.length > 320 ? "…" : ""}
          </p>
          <details className="agent-studio-v2-tech-details">
            <summary>Technical details</summary>
            <dl className="meta-grid">
              <div>
                <dt>Key</dt>
                <dd className="mono">{fields.manifestKey}</dd>
              </div>
              <div>
                <dt>ModelProfileVersion ID</dt>
                <dd className="mono">
                  {fields.modelProfileVersionId.length > 0
                    ? fields.modelProfileVersionId
                    : "Not selected"}
                </dd>
              </div>
              <div>
                <dt>Timeout</dt>
                <dd>{fields.timeoutMs} ms</dd>
              </div>
              <div>
                <dt>Max attempts</dt>
                <dd>{fields.maxAttempts}</dd>
              </div>
              <div>
                <dt>Model call budget</dt>
                <dd>{fields.maxModelInvocations}</dd>
              </div>
              <div>
                <dt>Tool call budget</dt>
                <dd>{fields.maxToolInvocations}</dd>
              </div>
              {fields.maxOutputTokens.trim().length > 0 ? (
                <div>
                  <dt>Max output tokens</dt>
                  <dd>{fields.maxOutputTokens}</dd>
                </div>
              ) : null}
            </dl>
          </details>
        </>
      ) : (
        <>
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
              <dd>{toolBindings}</dd>
            </div>
            <div>
              <dt>Knowledge bindings</dt>
              <dd>{knowledgeBindings}</dd>
            </div>
            <div>
              <dt>Memory bindings</dt>
              <dd>{memoryBindings}</dd>
            </div>
            <div>
              <dt>Timeout</dt>
              <dd>{fields.timeoutMs} ms</dd>
            </div>
            <div>
              <dt>Max attempts</dt>
              <dd>{fields.maxAttempts}</dd>
            </div>
            <div>
              <dt>Model call budget</dt>
              <dd>{fields.maxModelInvocations}</dd>
            </div>
            <div>
              <dt>Tool call budget</dt>
              <dd>{fields.maxToolInvocations}</dd>
            </div>
            {fields.maxOutputTokens.trim().length > 0 ? (
              <div>
                <dt>Max output tokens</dt>
                <dd>{fields.maxOutputTokens}</dd>
              </div>
            ) : null}
          </dl>
          <p className="muted">
            Instructions preview: {instructionsPreview}
            {fields.instructions.length > 320 ? "…" : ""}
          </p>
        </>
      )}
      {variant === "default" ? (
        !validation.ok ? (
          <p className="field-error" role="alert">
            Fix validation issues before publishing.
          </p>
        ) : (
          <p className="muted" role="status">
            Configuration passes local manifest validation. Execute a Run to
            verify provider and runtime behavior.
          </p>
        )
      ) : null}
    </section>
  );
}

function pickExecutionDraft(
  fields: DeclarativeStudioFields,
): ExecutionDraftFields {
  return {
    maxModelInvocations: fields.maxModelInvocations,
    maxToolInvocations: fields.maxToolInvocations,
    maxOutputTokens: fields.maxOutputTokens,
    timeoutMs: fields.timeoutMs,
    maxAttempts: fields.maxAttempts,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
