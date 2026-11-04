import { useEffect, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

import {
  applyDeclarativeStudioPatch,
  extractDeclarativeStudioFields,
  manifestToText,
  parseManifestRecord,
  type ManifestValidationView,
} from "../../lib/declarative-agent-manifest";
import {
  clearOptionalCapabilityFromManifest,
  readOptionalCapabilitiesFromManifest,
  type AgentStudioOptionalCapability,
} from "../../lib/agent-studio-v2-capabilities";
import {
  mergeExamplesIntoInstructions,
  removeExamplesFromInstructions,
  splitInstructionsAndExamples,
} from "../../lib/agent-studio-instructions-examples";
import { buildAgentStudioReviewBlockers } from "../../lib/agent-studio-v2-review-blockers";
import {
  AGENT_STUDIO_V2_STAGES,
  canAdvanceFromDescribe,
  canAdvanceFromEquip,
  reviewPublishReady,
  type AgentStudioV2StageId,
} from "../../lib/agent-studio-v2-stages";
import { AGENT_STUDIO_TEMPLATE_IDEAS } from "../../lib/agent-studio-v2-templates";
import { describeRegistryWriteFailure } from "../../lib/agent-manifest-draft";
import { describeControlPlaneWriteRoleRequirement } from "../../lib/control-plane-access";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { TextAreaField } from "../ui/field";
import { InlineMessage } from "../ui/inline-message";
import { Button } from "../ui/button";
import {
  DeclarativeAgentStudioEditor,
  AgentVersionReviewPanel,
  type AgentStudioEditorMode,
} from "./declarative-agent-studio-editor";
import { AgentStudioDraftGlance } from "./agent-studio-draft-glance";
import { AgentStudioTemplatesDialog } from "./agent-studio-templates-dialog";
import { AgentStudioV2Progress } from "./agent-studio-v2-progress";
import { KnowledgeBindingSelector } from "./knowledge-binding-selector";
import { MemoryBindingSelector } from "./memory-binding-selector";
import { ModelProfileVersionSelector } from "./model-profile-version-selector";
import { ToolVersionBindingSelector } from "./tool-version-binding-selector";

export function AgentStudioV2Workspace(props: {
  readonly agentName: string;
  readonly agentKey?: string;
  readonly onAgentNameChange?: (name: string) => void;
  readonly showAgentRegistrationFields?: boolean;
  readonly manifestText: string;
  readonly onManifestTextChange: (next: string) => void;
  readonly canWrite: boolean;
  readonly disabled?: boolean;
  readonly workspaceName?: string;
  readonly editorMode: AgentStudioEditorMode;
  readonly onEditorModeChange: (mode: AgentStudioEditorMode) => void;
  readonly validation: ManifestValidationView;
  readonly publishLabel: string;
  readonly onPublish: () => void | Promise<void>;
  readonly publishPending?: boolean;
  readonly partialPublishFailure?: boolean;
  readonly createdAgentId?: string;
  readonly feedback?: string;
  readonly errorRequestId?: string;
  readonly errorStatus?: number;
  readonly banner?: ReactNode;
  readonly initialTemplatesOpen?: boolean;
  readonly initialStage?: AgentStudioV2StageId;
  readonly onStageChange?: (stage: AgentStudioV2StageId) => void;
}) {
  const [stage, setStage] = useState<AgentStudioV2StageId>(
    () => props.initialStage ?? "describe",
  );
  const [maxStage, setMaxStage] = useState<AgentStudioV2StageId>(
    () => props.initialStage ?? "describe",
  );
  const [describeError, setDescribeError] = useState<string | undefined>();
  const [equipError, setEquipError] = useState<string | undefined>();
  const [instructionsTouched, setInstructionsTouched] = useState(false);
  const [optionalExamples, setOptionalExamples] = useState("");
  const [templatesOpen, setTemplatesOpen] = useState(
    () => props.initialTemplatesOpen ?? false,
  );
  const [confirmPublishOpen, setConfirmPublishOpen] = useState(false);
  const [templateConfirmId, setTemplateConfirmId] = useState<
    string | undefined
  >();
  const [optionalCaps, setOptionalCaps] = useState<
    Set<AgentStudioOptionalCapability>
  >(() => readOptionalCapabilitiesFromManifest(props.manifestText));

  const parsed = parseManifestRecord(props.manifestText);
  const fields = parsed.ok
    ? extractDeclarativeStudioFields(parsed.value)
    : extractDeclarativeStudioFields(undefined);
  const instructionSplit = useMemo(
    () => splitInstructionsAndExamples(fields.instructions),
    [fields.instructions],
  );
  const examplesInManifest = instructionSplit.examplesInManifest;
  const instructionBase = instructionSplit.baseInstructions;

  useEffect(() => {
    setOptionalCaps((current) => {
      const fromManifest = readOptionalCapabilitiesFromManifest(
        props.manifestText,
      );
      return new Set([...current, ...fromManifest]);
    });
  }, [props.manifestText]);

  useEffect(() => {
    if (examplesInManifest && optionalExamples !== instructionSplit.examples) {
      setOptionalExamples(instructionSplit.examples);
    }
  }, [examplesInManifest, instructionSplit.examples, optionalExamples]);

  useEffect(() => {
    props.onStageChange?.(stage);
  }, [props.onStageChange, stage]);

  function navigateStage(next: AgentStudioV2StageId): void {
    setStage(next);
  }

  function patchManifest(
    patch: Parameters<typeof applyDeclarativeStudioPatch>[1],
  ): void {
    if (!parsed.ok) {
      return;
    }
    props.onManifestTextChange(
      manifestToText(applyDeclarativeStudioPatch(parsed.value, patch)),
    );
  }

  function continueToEquip(): void {
    const gate = canAdvanceFromDescribe({
      agentName: props.agentName,
      instructions: instructionBase,
      manifestParseOk: parsed.ok,
    });
    if (!gate.ok) {
      setDescribeError(gate.message);
      return;
    }
    setDescribeError(undefined);
    navigateStage("equip");
    setMaxStage("equip");
  }

  function continueToReview(): void {
    const gate = canAdvanceFromEquip({
      manifestParseOk: parsed.ok,
      modelProfileVersionId: fields.modelProfileVersionId,
    });
    if (!gate.ok) {
      setEquipError(gate.message);
    } else {
      setEquipError(undefined);
    }
    navigateStage("review");
    setMaxStage("review");
  }

  const showInstructionsFieldError =
    describeError ??
    (instructionsTouched || stage !== "describe"
      ? props.validation.fieldErrors.instructions
      : undefined);

  function applyTemplate(templateId: string): void {
    const idea = AGENT_STUDIO_TEMPLATE_IDEAS.find(
      (entry) => entry.id === templateId,
    );
    if (idea === undefined) {
      return;
    }
    const hasDraft =
      props.agentName.trim().length > 0 ||
      fields.instructions.trim().length > 0;
    if (hasDraft) {
      setTemplateConfirmId(templateId);
      return;
    }
    commitTemplate(idea.id);
  }

  function commitTemplate(templateId: string): void {
    const idea = AGENT_STUDIO_TEMPLATE_IDEAS.find(
      (entry) => entry.id === templateId,
    );
    if (idea === undefined) {
      return;
    }
    props.onAgentNameChange?.(idea.suggestedName);
    patchManifest({ instructions: idea.instructions });
    setOptionalExamples("");
    setTemplateConfirmId(undefined);
  }

  const publishReady = reviewPublishReady({
    canWrite: props.canWrite,
    validation: props.validation,
    manifestParseOk: parsed.ok,
  });

  const reviewBlockers = useMemo(
    () =>
      buildAgentStudioReviewBlockers({
        validation: props.validation,
        modelProfileVersionId: fields.modelProfileVersionId,
        instructions: instructionBase,
        agentName: props.showAgentRegistrationFields
          ? props.agentName
          : fields.manifestName,
      }),
    [
      props.validation,
      fields.modelProfileVersionId,
      instructionBase,
      props.agentName,
      props.showAgentRegistrationFields,
      fields.manifestName,
    ],
  );

  function removeOptionalCapability(
    capability: AgentStudioOptionalCapability,
  ): void {
    setOptionalCaps((current) => {
      const next = new Set(current);
      next.delete(capability);
      return next;
    });
    props.onManifestTextChange(
      clearOptionalCapabilityFromManifest(props.manifestText, capability),
    );
  }

  function applyExamplesToManifest(): void {
    if (!parsed.ok || optionalExamples.trim().length === 0) {
      return;
    }
    patchManifest({
      instructions: mergeExamplesIntoInstructions(
        instructionBase,
        optionalExamples,
      ),
    });
  }

  function removeExamplesFromManifestDraft(): void {
    if (!parsed.ok) {
      return;
    }
    patchManifest({
      instructions: removeExamplesFromInstructions(fields.instructions),
    });
  }

  function publishWithOptionalExamples(): void {
    if (
      parsed.ok &&
      optionalExamples.trim().length > 0 &&
      !examplesInManifest
    ) {
      const nextText = manifestToText(
        applyDeclarativeStudioPatch(parsed.value, {
          instructions: mergeExamplesIntoInstructions(
            instructionBase,
            optionalExamples,
          ),
        }),
      );
      flushSync(() => {
        props.onManifestTextChange(nextText);
      });
    }
    void props.onPublish();
  }

  const modeToolbar = (
    <div className="toolbar agent-studio-v2-mode">
      <Button
        type="button"
        variant={props.editorMode === "guided" ? "primary" : "secondary"}
        disabled={props.disabled}
        onClick={() => props.onEditorModeChange("guided")}
      >
        Guided
      </Button>
      <Button
        type="button"
        variant={props.editorMode === "advanced" ? "primary" : "secondary"}
        disabled={props.disabled}
        onClick={() => props.onEditorModeChange("advanced")}
      >
        Advanced JSON
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={props.disabled}
        onClick={() => setTemplatesOpen(true)}
      >
        Templates
      </Button>
    </div>
  );

  const invalidJsonInGuided =
    !parsed.ok && props.editorMode === "guided" ? (
      <InlineMessage tone="warning" title="Manifest JSON is invalid">
        Guided editing is paused so your raw draft is preserved. Switch to{" "}
        <button
          type="button"
          className="button"
          onClick={() => props.onEditorModeChange("advanced")}
        >
          Advanced JSON
        </button>{" "}
        to fix syntax, then return to Guided.
      </InlineMessage>
    ) : null;

  const describeStage = (
    <section
      className="agent-studio-v2-stage panel"
      aria-labelledby="as-describe"
      data-testid="agent-studio-stage-describe"
    >
      <p className="agent-studio-v2-eyebrow">Step 1 · Describe</p>
      <h2 id="as-describe" className="agent-studio-v2-headline">
        What should your agent do?
      </h2>
      <p className="muted agent-studio-v2-lead">
        Name your agent and explain its job in plain language. Technical keys
        stay out of the way until you need them.
      </p>
      {props.showAgentRegistrationFields ? (
        <div className="field">
          <label htmlFor="create-agent-name" className="field-label">
            Agent name
          </label>
          <input
            id="create-agent-name"
            className="ui-control"
            value={props.agentName}
            disabled={props.disabled || !props.canWrite}
            autoComplete="off"
            onChange={(event) => props.onAgentNameChange?.(event.target.value)}
          />
        </div>
      ) : (
        <div className="field">
          <label htmlFor="studio-manifest-name" className="field-label">
            Agent name
          </label>
          <input
            id="studio-manifest-name"
            className="ui-control"
            value={fields.manifestName}
            disabled={props.disabled || !parsed.ok || !props.canWrite}
            onChange={(event) =>
              patchManifest({ manifestName: event.target.value })
            }
          />
        </div>
      )}

      <TextAreaField
        id="studio-instructions"
        label="Instructions"
        required
        rows={8}
        value={instructionBase}
        disabled={props.disabled || !parsed.ok || !props.canWrite}
        error={showInstructionsFieldError}
        hint="What should this agent accomplish? How should it respond? What should it refuse?"
        onChange={(event) => {
          setInstructionsTouched(true);
          const base = event.target.value;
          patchManifest({
            instructions: examplesInManifest
              ? mergeExamplesIntoInstructions(base, optionalExamples)
              : base,
          });
        }}
        onBlur={() => setInstructionsTouched(true)}
      />

      <TextAreaField
        id="studio-examples"
        label="Example interactions"
        optional
        rows={4}
        value={optionalExamples}
        disabled={props.disabled || !props.canWrite}
        hint="Optional samples stored separately until you apply them to instructions. Navigating stages does not change instructions automatically."
        onChange={(event) => setOptionalExamples(event.target.value)}
      />
      {optionalExamples.trim().length > 0 ? (
        <div className="agent-studio-examples-actions">
          {examplesInManifest ? (
            <>
              <p className="muted" role="status">
                Examples are included in the published instructions block.
              </p>
              <Button
                type="button"
                variant="secondary"
                disabled={props.disabled}
                onClick={removeExamplesFromManifestDraft}
              >
                Remove examples from instructions
              </Button>
            </>
          ) : (
            <>
              <p className="muted" role="status">
                Examples are not part of instructions yet.
              </p>
              <Button
                type="button"
                variant="secondary"
                disabled={props.disabled || !parsed.ok}
                onClick={applyExamplesToManifest}
              >
                Add examples to instructions
              </Button>
            </>
          )}
        </div>
      ) : null}

      <div className="agent-studio-v2-stage-actions">
        <Button
          type="button"
          variant="primary"
          disabled={props.disabled}
          onClick={continueToEquip}
        >
          Continue to capabilities
        </Button>
      </div>
    </section>
  );

  const equipStage = (
    <section
      className="agent-studio-v2-stage panel"
      aria-labelledby="as-equip"
      data-testid="agent-studio-stage-equip"
    >
      <p className="agent-studio-v2-eyebrow">Step 2 · Equip</p>
      <h2 id="as-equip" className="agent-studio-v2-headline">
        What will your agent need?
      </h2>
      <p className="muted agent-studio-v2-lead">
        Pick a workspace model version. Add tools, knowledge, or memory only if
        you need them.
      </p>

      <div className="agent-studio-v2-capability-card">
        <h3 className="agent-studio-v2-capability-title">
          AI model
          <span className="field-badge field-badge-required">Required</span>
        </h3>
        <ModelProfileVersionSelector
          presentation="studio"
          value={fields.modelProfileVersionId}
          disabled={props.disabled || !parsed.ok || !props.canWrite}
          onChange={(selection) => {
            patchManifest({
              modelProfileVersionId: selection?.modelProfileVersionId ?? "",
            });
          }}
        />
        {equipError !== undefined ? (
          <p className="field-error" role="alert">
            {equipError}
          </p>
        ) : null}
      </div>

      <div className="agent-studio-v2-optional-grid">
        {renderOptionalCapability(
          "tools",
          "Tools",
          "Let your agent call approved tools from this workspace.",
          optionalCaps.has("tools"),
          () => setOptionalCaps((current) => new Set([...current, "tools"])),
          () => removeOptionalCapability("tools"),
          optionalCaps.has("tools") ? (
            <ToolVersionBindingSelector
              key="tools-editor"
              presentation="studio"
              manifestText={props.manifestText}
              disabled={props.disabled || !props.canWrite}
              onManifestChange={props.onManifestTextChange}
            />
          ) : null,
        )}
        {renderOptionalCapability(
          "knowledge",
          "Knowledge",
          "Ground answers in workspace knowledge indexes.",
          optionalCaps.has("knowledge"),
          () =>
            setOptionalCaps((current) => new Set([...current, "knowledge"])),
          () => removeOptionalCapability("knowledge"),
          optionalCaps.has("knowledge") ? (
            <KnowledgeBindingSelector
              presentation="studio"
              manifestText={props.manifestText}
              disabled={props.disabled || !props.canWrite}
              onManifestChange={props.onManifestTextChange}
            />
          ) : null,
        )}
        {renderOptionalCapability(
          "memory",
          "Memory",
          "Configure namespaces your agent may read or write.",
          optionalCaps.has("memory"),
          () => setOptionalCaps((current) => new Set([...current, "memory"])),
          () => removeOptionalCapability("memory"),
          optionalCaps.has("memory") ? (
            <MemoryBindingSelector
              presentation="studio"
              manifestText={props.manifestText}
              disabled={props.disabled || !props.canWrite}
              onManifestChange={props.onManifestTextChange}
            />
          ) : null,
        )}
      </div>

      <div className="agent-studio-v2-stage-actions">
        <Button
          type="button"
          variant="secondary"
          onClick={() => navigateStage("describe")}
        >
          Back
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={props.disabled}
          onClick={continueToReview}
        >
          Continue to review
        </Button>
      </div>
    </section>
  );

  const reviewStage = (
    <section
      className="agent-studio-v2-stage panel"
      aria-labelledby="as-review"
      data-testid="agent-studio-stage-review"
    >
      <p className="agent-studio-v2-eyebrow">Step 3 · Review</p>
      <h2 id="as-review" className="agent-studio-v2-headline">
        Review your agent
      </h2>
      {props.workspaceName !== undefined ? (
        <p className="muted">
          Publishing in workspace <strong>{props.workspaceName}</strong>
          {!props.canWrite ? " — you can review but not publish here." : null}
        </p>
      ) : null}
      <AgentVersionReviewPanel
        variant="studio"
        manifestText={props.manifestText}
      />
      {!publishReady && reviewBlockers.length > 0 ? (
        <div
          className="agent-studio-v2-blockers"
          role="alert"
          data-testid="agent-studio-review-blockers"
        >
          <h3 className="section-title">Before you can publish</h3>
          <ul>
            {reviewBlockers.map((blocker) => (
              <li key={blocker.id}>
                {blocker.message}{" "}
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => navigateStage(blocker.stage)}
                >
                  {blocker.actionLabel}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <details className="agent-studio-v2-tech-details">
        <summary>Technical validation details</summary>
        <ul className="agent-studio-validation-list">
          {props.validation.messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      </details>
      <div className="agent-studio-v2-stage-actions">
        <Button
          type="button"
          variant="secondary"
          onClick={() => navigateStage("equip")}
        >
          Back
        </Button>
        {props.canWrite ? (
          <Button
            type="button"
            variant="primary"
            disabled={
              !publishReady ||
              reviewBlockers.length > 0 ||
              props.disabled ||
              props.publishPending
            }
            data-testid="agent-studio-publish-button"
            onClick={() => setConfirmPublishOpen(true)}
          >
            {props.publishPending ? "Publishing…" : props.publishLabel}
          </Button>
        ) : null}
      </div>
      {props.errorStatus !== undefined ? (
        <p className="error-inline">
          {describeRegistryWriteFailure(props.errorStatus)}
        </p>
      ) : null}
      {props.feedback !== undefined ? (
        <p className="error-inline">{props.feedback}</p>
      ) : null}
      {props.errorRequestId !== undefined ? (
        <p className="muted">
          Request ID: <span className="mono">{props.errorRequestId}</span>
        </p>
      ) : null}
    </section>
  );

  const guidedBody =
    props.editorMode === "guided" ? (
      <>
        {invalidJsonInGuided}
        {stage === "describe" ? describeStage : null}
        {stage === "equip" ? equipStage : null}
        {stage === "review" ? reviewStage : null}
      </>
    ) : (
      <DeclarativeAgentStudioEditor
        manifestText={props.manifestText}
        disabled={props.disabled || !props.canWrite}
        mode="advanced"
        layoutVariant="advanced-only"
        onModeChange={props.onEditorModeChange}
        onManifestTextChange={props.onManifestTextChange}
        validation={props.validation}
      />
    );

  return (
    <div className="agent-studio-v2" data-testid="agent-studio-v2">
      {props.banner}
      {!props.canWrite ? (
        <div data-testid="agent-studio-readonly-notice">
          <InlineMessage tone="info" title="Read-only workspace access">
            {describeControlPlaneWriteRoleRequirement()} Guided fields and
            publishing are disabled; you can still review configuration.
          </InlineMessage>
        </div>
      ) : null}
      {modeToolbar}
      {props.editorMode === "guided" ? (
        <AgentStudioV2Progress
          current={stage}
          maxReachable={maxStage}
          onNavigate={(next) => {
            if (describeStageIndex(next) <= describeStageIndex(maxStage)) {
              navigateStage(next);
            }
          }}
        />
      ) : null}
      <div className="agent-studio-v2-body">
        <div className="agent-studio-v2-main">{guidedBody}</div>
        {props.editorMode === "guided" ? (
          <AgentStudioDraftGlance
            agentName={
              props.showAgentRegistrationFields
                ? props.agentName
                : fields.manifestName
            }
            manifestText={props.manifestText}
            canWrite={props.canWrite}
            optionalToolsEnabled={optionalCaps.has("tools")}
            optionalKnowledgeEnabled={optionalCaps.has("knowledge")}
            optionalMemoryEnabled={optionalCaps.has("memory")}
          />
        ) : null}
      </div>

      <AgentStudioTemplatesDialog
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onApply={applyTemplate}
      />

      <ConfirmDialog
        open={confirmPublishOpen}
        title="Publish immutable AgentVersion?"
        description="Publishing saves a new immutable version. It does not run the agent. Model and tool usage during later Runs may incur provider costs."
        confirmLabel={props.publishLabel}
        cancelLabel="Keep editing"
        pending={props.publishPending}
        onCancel={() => setConfirmPublishOpen(false)}
        onConfirm={() => {
          setConfirmPublishOpen(false);
          publishWithOptionalExamples();
        }}
      />

      <ConfirmDialog
        open={templateConfirmId !== undefined}
        title="Replace current draft?"
        description="Applying a template idea replaces the name and instructions. Other manifest fields are kept."
        confirmLabel="Replace draft"
        cancelLabel="Cancel"
        onCancel={() => setTemplateConfirmId(undefined)}
        onConfirm={() => {
          if (templateConfirmId !== undefined) {
            commitTemplate(templateConfirmId);
          }
        }}
      />
    </div>
  );
}

function renderOptionalCapability(
  id: AgentStudioOptionalCapability,
  title: string,
  description: string,
  enabled: boolean,
  onAdd: () => void,
  onRemove: () => void,
  editor: ReactNode,
): ReactNode {
  return (
    <div className="agent-studio-v2-capability-card" data-capability={id}>
      <div className="agent-studio-v2-capability-head">
        <div>
          <h3 className="agent-studio-v2-capability-title">{title}</h3>
          <p className="muted">{description}</p>
        </div>
        {!enabled ? (
          <Button type="button" variant="secondary" onClick={onAdd}>
            Add {title.toLowerCase()}
          </Button>
        ) : (
          <Button type="button" variant="secondary" onClick={onRemove}>
            Remove {title.toLowerCase()}
          </Button>
        )}
      </div>
      {enabled ? editor : null}
    </div>
  );
}

function describeStageIndex(stage: AgentStudioV2StageId): number {
  return AGENT_STUDIO_V2_STAGES.findIndex((entry) => entry.id === stage);
}
