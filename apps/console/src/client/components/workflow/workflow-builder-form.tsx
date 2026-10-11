import type { WorkflowV3NodeType } from "@osva-ai/contracts";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { useAgentBindingResolution } from "../../hooks/use-agent-binding-resolution";
import { LoadingBlock } from "../loading/loading-block";
import type { WorkflowBuilderDraft } from "../../lib/workflow-builder-draft";
import { updateRegistry } from "../../lib/workflow-builder-draft";
import {
  addWorkflowNode,
  setAgentNodeVersion,
} from "../../lib/workflow-builder-graph";
import type { AgentVersionId } from "@osva-ai/contracts";
import {
  asWorkflowDefinitionView,
  orderWorkflowNodeKeys,
} from "../../lib/workflow-definition";
import {
  analyzeWorkflowBuilderDraft,
  errorNodeKeys,
  issuesForNode,
} from "../../lib/workflow-builder-validation";
import {
  WorkflowNodeInspector,
  WorkflowNodePalette,
} from "./workflow-node-inspector";
import { WorkflowValidationPanel } from "./workflow-validation-panel";

const WorkflowBuilderCanvasLazy = lazy(async () => {
  const module = await import("./workflow-builder-canvas");
  return { default: module.WorkflowBuilderCanvas };
});

interface WorkflowBuilderFormProps {
  readonly draft: WorkflowBuilderDraft;
  readonly onDraftChange: (draft: WorkflowBuilderDraft) => void;
  readonly registryLocked: boolean;
  readonly disabled: boolean;
}

export function WorkflowBuilderForm({
  draft,
  onDraftChange,
  registryLocked,
  disabled,
}: WorkflowBuilderFormProps) {
  const bindingResolution = useAgentBindingResolution(draft);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | undefined>();
  const [manualAgentIdByNodeKey, setManualAgentIdByNodeKey] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    setManualAgentIdByNodeKey({});
    setSelectedNodeKey(undefined);
  }, [draft.draftId]);

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

  function addNode(type: WorkflowV3NodeType) {
    const next = addWorkflowNode(draft, type);
    onDraftChange(next);
    const created = next.definition.nodes[next.definition.nodes.length - 1];
    if (created !== undefined) {
      setSelectedNodeKey(created.key);
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <h2 className="section-title">Workflow registry</h2>
        <div className="stack">
          <div className="field">
            <label htmlFor="workflow-key">Key</label>
            <input
              id="workflow-key"
              value={draft.registry.key}
              disabled={disabled || registryLocked}
              onChange={(event) =>
                onDraftChange(
                  updateRegistry(draft, {
                    ...draft.registry,
                    key: event.target.value,
                  }),
                )
              }
            />
          </div>
          <div className="field">
            <label htmlFor="workflow-name">Name</label>
            <input
              id="workflow-name"
              value={draft.registry.name}
              disabled={disabled || registryLocked}
              onChange={(event) =>
                onDraftChange(
                  updateRegistry(draft, {
                    ...draft.registry,
                    name: event.target.value,
                  }),
                )
              }
            />
          </div>
          <div className="field">
            <label htmlFor="workflow-description">Description (optional)</label>
            <textarea
              id="workflow-description"
              rows={2}
              value={draft.registry.description ?? ""}
              disabled={disabled || registryLocked}
              onChange={(event) => {
                const description = event.target.value.trim();
                onDraftChange(
                  updateRegistry(draft, {
                    ...draft.registry,
                    ...(description.length > 0 ? { description } : {}),
                  }),
                );
              }}
            />
          </div>
        </div>
      </section>

      <section className="panel">
        <h2 className="section-title">Workflow graph</h2>
        <p className="muted workflow-graph-intro">
          Drag nodes to arrange layout (saved in your draft only). Connect
          handles to add edges; select an edge and press Delete to remove. Use
          the inspector or node list for configuration without the canvas.
        </p>
        <WorkflowNodePalette disabled={disabled} onAddNode={addNode} />
        {bindingResolution.isResolving ? (
          <p className="muted">Loading agent version bindings…</p>
        ) : null}
        <Suspense fallback={<LoadingBlock label="Loading graph editor…" />}>
          <WorkflowBuilderCanvasLazy
            draft={draft}
            onDraftChange={onDraftChange}
            disabled={disabled}
            selectedNodeKey={selectedNodeKey}
            onSelectNodeKey={setSelectedNodeKey}
            errorNodeKeys={invalidNodeKeys}
          />
        </Suspense>
      </section>

      <WorkflowValidationPanel
        report={validationReport}
        onFocusNode={setSelectedNodeKey}
      />

      <section className="panel">
        <h2 className="section-title">Node inspector</h2>
        <WorkflowNodeInspector
          draft={draft}
          nodeKey={selectedNodeKey}
          onDraftChange={onDraftChange}
          disabled={disabled}
          agentIdByNodeKey={agentIdByNodeKey}
          unavailableVersionByNodeKey={
            bindingResolution.unavailableVersionByNodeKey
          }
          nodeIssues={selectedNodeIssues}
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
      </section>

      <section className="panel">
        <h2 className="section-title">Nodes (accessible list)</h2>
        {orderedKeys.length === 0 ? (
          <p className="muted">Add nodes using the palette above.</p>
        ) : (
          <ul className="stack workflow-node-accessible-list">
            {orderedKeys.map((key) => {
              const node = draft.definition.nodes.find(
                (candidate) => candidate.key === key,
              );
              if (node === undefined) {
                return null;
              }
              return (
                <li key={key}>
                  <button
                    type="button"
                    className={`button${selectedNodeKey === key ? " primary" : ""}`}
                    disabled={disabled}
                    onClick={() => setSelectedNodeKey(key)}
                  >
                    <span className="mono">
                      {node.key} · {node.type}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
