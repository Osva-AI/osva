import type { AgentVersionId, WorkflowV3NodeType } from "@osva-ai/contracts";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const MOBILE_STUDIO_MEDIA = "(max-width: 1024px)";

function subscribeMobileStudio(onChange: () => void): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => undefined;
  }
  const media = window.matchMedia(MOBILE_STUDIO_MEDIA);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function readMobileStudio(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia(MOBILE_STUDIO_MEDIA).matches;
}

import { useAgentBindingResolution } from "../../hooks/use-agent-binding-resolution";
import { useWorkflowCanvasLabelContext } from "../../hooks/use-workflow-canvas-label-context";
import { LoadingBlock } from "../loading/loading-block";
import type { WorkflowBuilderDraft } from "../../lib/workflow-builder-draft";
import {
  addWorkflowNode,
  setAgentNodeVersion,
} from "../../lib/workflow-builder-graph";
import {
  asWorkflowDefinitionView,
  orderWorkflowNodeKeys,
} from "../../lib/workflow-definition";
import { resolveWorkflowCanvasLabel } from "../../lib/workflow-canvas-labels";
import { workflowNodePresentation } from "../../lib/workflow-node-catalog";
import {
  analyzeWorkflowBuilderDraft,
  errorNodeKeys,
  issuesForNode,
} from "../../lib/workflow-builder-validation";
import { WorkflowNodeInspector } from "./workflow-node-inspector";
import { WorkflowStudioKeyboardGraphPanel } from "./workflow-studio-keyboard-graph-panel";
import { WorkflowStudioSheet } from "./workflow-studio-sheet";
import { WorkflowStudioStepPalette } from "./workflow-studio-step-palette";
import { WorkflowValidationBar } from "./workflow-validation-bar";
import { Button } from "../ui/button";

const WorkflowBuilderCanvasLazy = lazy(async () => {
  const module = await import("./workflow-builder-canvas");
  return { default: module.WorkflowBuilderCanvas };
});

export interface WorkflowStudioEditorProps {
  readonly draft: WorkflowBuilderDraft;
  readonly onDraftChange: (draft: WorkflowBuilderDraft) => void;
  readonly disabled: boolean;
  readonly selectedNodeKey: string | undefined;
  readonly onSelectNodeKey: (nodeKey: string | undefined) => void;
  readonly onOpenRegistryDetails: () => void;
  readonly inspectorOpen: boolean;
  readonly onInspectorOpenChange: (open: boolean) => void;
  readonly showAdvanced: boolean;
  readonly focusMode: boolean;
  readonly focusPaletteOpen: boolean;
  readonly onFocusPaletteOpenChange: (open: boolean) => void;
  readonly focusInspectorOpen: boolean;
  readonly onFocusInspectorOpenChange: (open: boolean) => void;
}

export function WorkflowStudioEditor({
  draft,
  onDraftChange,
  disabled,
  selectedNodeKey,
  onSelectNodeKey,
  onOpenRegistryDetails,
  inspectorOpen,
  onInspectorOpenChange,
  showAdvanced,
  focusMode,
  focusPaletteOpen,
  onFocusPaletteOpenChange,
  focusInspectorOpen,
  onFocusInspectorOpenChange,
}: WorkflowStudioEditorProps) {
  const bindingResolution = useAgentBindingResolution(draft);
  const canvasLabels = useWorkflowCanvasLabelContext();
  const [manualAgentIdByNodeKey, setManualAgentIdByNodeKey] = useState<
    Record<string, string>
  >({});
  const [paletteSheetOpen, setPaletteSheetOpen] = useState(false);
  const [stepsListOpen, setStepsListOpen] = useState(false);
  const [inspectorSheetOpen, setInspectorSheetOpen] = useState(false);
  const isMobileStudio = useSyncExternalStore(
    subscribeMobileStudio,
    readMobileStudio,
    () => false,
  );

  useEffect(() => {
    setManualAgentIdByNodeKey({});
  }, [draft.draftId]);

  useEffect(() => {
    if (inspectorOpen && selectedNodeKey !== undefined && isMobileStudio) {
      setInspectorSheetOpen(true);
    }
  }, [inspectorOpen, selectedNodeKey, isMobileStudio]);

  const agentIdByNodeKey = useMemo(
    () => ({
      ...bindingResolution.agentIdByNodeKey,
      ...manualAgentIdByNodeKey,
    }),
    [bindingResolution.agentIdByNodeKey, manualAgentIdByNodeKey],
  );

  const orderedKeys = useMemo(
    () => orderWorkflowNodeKeys(asWorkflowDefinitionView(draft.definition)),
    [draft.definition],
  );

  const validationReport = useMemo(
    () => analyzeWorkflowBuilderDraft(draft),
    [draft],
  );
  const invalidNodeKeys = useMemo(
    () => errorNodeKeys(validationReport),
    [validationReport],
  );
  const selectedNodeIssues = useMemo(
    () =>
      selectedNodeKey === undefined
        ? []
        : issuesForNode(validationReport, selectedNodeKey),
    [selectedNodeKey, validationReport],
  );

  const draftStatusLabel =
    draft.createdWorkflowId !== undefined
      ? "Draft · workflow registered"
      : "Draft · not published";

  const paletteVisible = !focusMode || focusPaletteOpen;
  const inspectorVisible = !focusMode || focusInspectorOpen;

  function addNode(type: WorkflowV3NodeType) {
    const next = addWorkflowNode(draft, type);
    onDraftChange(next);
    const created = next.definition.nodes[next.definition.nodes.length - 1];
    if (created !== undefined) {
      onSelectNodeKey(created.key);
      onInspectorOpenChange(true);
      if (focusMode) {
        onFocusInspectorOpenChange(true);
      }
      if (isMobileStudio) {
        setInspectorSheetOpen(true);
      }
    }
    setPaletteSheetOpen(false);
    onFocusPaletteOpenChange(false);
  }

  const emptyCanvas = draft.definition.nodes.length === 0;

  const editorClassName = [
    "workflow-studio-editor",
    focusMode ? "workflow-studio-editor--focus" : "",
    focusMode && paletteVisible ? "workflow-studio-editor--palette-open" : "",
    focusMode && inspectorVisible
      ? "workflow-studio-editor--inspector-open"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  function renderInspectorBody(): ReactNode {
    return (
      <>
        <div className="workflow-studio-inspector-head">
          <h2 className="workflow-studio-inspector-title">Step settings</h2>
          <Button
            type="button"
            variant="secondary"
            aria-label="Close inspector"
            onClick={() => {
              onInspectorOpenChange(false);
              onFocusInspectorOpenChange(false);
              setInspectorSheetOpen(false);
            }}
          >
            Done
          </Button>
        </div>
        <WorkflowNodeInspector
          draft={draft}
          nodeKey={selectedNodeKey}
          onDraftChange={onDraftChange}
          disabled={disabled}
          showAdvanced={showAdvanced}
          agentIdByNodeKey={agentIdByNodeKey}
          unavailableVersionByNodeKey={
            bindingResolution.unavailableVersionByNodeKey
          }
          nodeIssues={selectedNodeIssues}
          canvasLabelContext={canvasLabels}
          onManualAgentIdChange={(nodeKey, agentId) => {
            setManualAgentIdByNodeKey((current) => ({
              ...current,
              [nodeKey]: agentId,
            }));
            onDraftChange(
              setAgentNodeVersion(draft, nodeKey, "" as AgentVersionId),
            );
          }}
        />
      </>
    );
  }

  function renderStepsList(): ReactNode {
    if (orderedKeys.length === 0) {
      return <p className="muted">Add steps using Add step.</p>;
    }
    return (
      <ul className="stack workflow-node-accessible-list">
        {orderedKeys.map((key) => {
          const node = draft.definition.nodes.find(
            (candidate) => candidate.key === key,
          );
          if (node === undefined) {
            return null;
          }
          const label = resolveWorkflowCanvasLabel(node, canvasLabels);
          const typeLabel = workflowNodePresentation(node.type).label;
          return (
            <li key={key}>
              <button
                type="button"
                className={`button${selectedNodeKey === key ? " primary" : ""}`}
                disabled={disabled}
                data-testid={`workflow-a11y-step-${key}`}
                onClick={() => {
                  onSelectNodeKey(key);
                  onInspectorOpenChange(true);
                  setStepsListOpen(false);
                  setInspectorSheetOpen(true);
                  if (focusMode) {
                    onFocusInspectorOpenChange(true);
                  }
                }}
              >
                {typeLabel}: {label}
                {showAdvanced ? (
                  <span className="mono"> ({node.key})</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className={editorClassName}>
      {paletteVisible ? (
        <aside
          className="workflow-studio-editor-palette"
          aria-label="Step palette"
        >
          <WorkflowStudioStepPalette disabled={disabled} onAddNode={addNode} />
        </aside>
      ) : null}

      <div className="workflow-studio-editor-canvas-wrap">
        {focusMode ? (
          <div className="workflow-studio-focus-chrome">
            <Button
              type="button"
              variant="secondary"
              aria-expanded={focusPaletteOpen}
              onClick={() => onFocusPaletteOpenChange(!focusPaletteOpen)}
            >
              {focusPaletteOpen ? "Hide steps" : "Show steps"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              aria-expanded={focusInspectorOpen}
              disabled={selectedNodeKey === undefined}
              onClick={() => onFocusInspectorOpenChange(!focusInspectorOpen)}
            >
              {focusInspectorOpen ? "Hide settings" : "Step settings"}
            </Button>
          </div>
        ) : null}
        {bindingResolution.isResolving ? (
          <p className="workflow-studio-canvas-status">
            Loading agent version bindings…
          </p>
        ) : null}
        {emptyCanvas ? (
          <div className="workflow-studio-empty-canvas">
            <h2>Build your workflow</h2>
            <p className="workflow-studio-empty-canvas-lead">
              Add a step from the palette, then connect steps on the canvas.
              Select a step to configure agents, approvals, waits, and branches.
            </p>
          </div>
        ) : null}
        <Suspense fallback={<LoadingBlock label="Loading graph editor…" />}>
          <WorkflowBuilderCanvasLazy
            draft={draft}
            onDraftChange={onDraftChange}
            disabled={disabled}
            selectedNodeKey={selectedNodeKey}
            onSelectNodeKey={(key) => {
              onSelectNodeKey(key);
              if (key !== undefined) {
                onInspectorOpenChange(true);
                setInspectorSheetOpen(true);
                if (focusMode) {
                  onFocusInspectorOpenChange(true);
                }
                if (isMobileStudio) {
                  setInspectorSheetOpen(true);
                }
              }
            }}
            errorNodeKeys={invalidNodeKeys}
            canvasLabelContext={canvasLabels}
            showTechnicalKey={showAdvanced}
          />
        </Suspense>
      </div>

      {inspectorVisible ? (
        <aside
          className={`workflow-studio-editor-inspector${inspectorOpen || focusInspectorOpen ? " is-open" : ""}`}
          aria-label="Step configuration"
          data-testid="workflow-studio-inspector"
        >
          {renderInspectorBody()}
        </aside>
      ) : null}

      <div className="workflow-studio-mobile-toolbar">
        <Button
          type="button"
          variant="primary"
          disabled={disabled}
          onClick={() => setPaletteSheetOpen(true)}
        >
          Add step
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setStepsListOpen(true)}
        >
          Steps list
        </Button>
        {selectedNodeKey !== undefined ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onInspectorOpenChange(true);
              setInspectorSheetOpen(true);
            }}
          >
            Step settings
          </Button>
        ) : null}
      </div>

      {isMobileStudio ? (
        <>
          <WorkflowStudioSheet
            open={paletteSheetOpen}
            title="Add step"
            ariaLabel="Add workflow step"
            onClose={() => setPaletteSheetOpen(false)}
          >
            <WorkflowStudioStepPalette
              disabled={disabled}
              compact
              onAddNode={addNode}
            />
          </WorkflowStudioSheet>

          <WorkflowStudioSheet
            open={stepsListOpen}
            title="Steps (accessible list)"
            ariaLabel="Accessible steps list"
            onClose={() => setStepsListOpen(false)}
          >
            {renderStepsList()}
          </WorkflowStudioSheet>
        </>
      ) : null}

      {isMobileStudio ? (
        <WorkflowStudioSheet
          open={inspectorSheetOpen && selectedNodeKey !== undefined}
          title="Step settings"
          ariaLabel="Step configuration"
          onClose={() => {
            setInspectorSheetOpen(false);
            onInspectorOpenChange(false);
          }}
        >
          {renderInspectorBody()}
        </WorkflowStudioSheet>
      ) : null}

      <details className="workflow-studio-a11y-steps">
        <summary>Accessible steps list</summary>
        {renderStepsList()}
        <WorkflowStudioKeyboardGraphPanel
          draft={draft}
          disabled={disabled}
          canvasLabelContext={canvasLabels}
          onDraftChange={onDraftChange}
        />
      </details>

      <WorkflowValidationBar
        report={validationReport}
        onFocusNode={(key) => {
          onSelectNodeKey(key);
          onInspectorOpenChange(true);
          setInspectorSheetOpen(true);
          if (focusMode) {
            onFocusInspectorOpenChange(true);
          }
        }}
        onFocusRegistry={onOpenRegistryDetails}
        draftStatusLabel={draftStatusLabel}
      />
    </div>
  );
}
