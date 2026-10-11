import type { AgentVersionId } from "@osva-ai/contracts";
import { useEffect, useMemo, useState } from "react";

import { useAgentBindingResolution } from "../../hooks/use-agent-binding-resolution";
import {
  useAgentVersionsQuery,
  useAgentsListQuery,
  type AgentResource,
  type AgentVersionResource,
} from "../../hooks/use-agents";
import type { WorkflowBuilderDraft } from "../../lib/workflow-builder-linear";
import {
  addAgentNode,
  listAgentNodesInOrder,
  moveAgentNode,
  removeAgentNode,
  setAgentNodeVersion,
  updateRegistry,
} from "../../lib/workflow-builder-linear";

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
  const agentsQuery = useAgentsListQuery();
  const bindingResolution = useAgentBindingResolution(draft);
  const [manualAgentIdByNodeKey, setManualAgentIdByNodeKey] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    setManualAgentIdByNodeKey({});
  }, [draft.draftId]);

  const orderedNodes = useMemo(() => listAgentNodesInOrder(draft), [draft]);

  const agentIdByNodeKey = useMemo(
    () => ({
      ...bindingResolution.agentIdByNodeKey,
      ...manualAgentIdByNodeKey,
    }),
    [bindingResolution.agentIdByNodeKey, manualAgentIdByNodeKey],
  );

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
        <div className="page-header" style={{ marginBottom: 12 }}>
          <h2 className="section-title">AGENT steps (linear)</h2>
          <button
            type="button"
            className="button"
            disabled={disabled}
            onClick={() => onDraftChange(addAgentNode(draft))}
          >
            Add step
          </button>
        </div>
        {agentsQuery.isLoading || bindingResolution.isResolving ? (
          <p className="muted">Loading agents and version bindings…</p>
        ) : null}
        {agentsQuery.isError ? (
          <p className="muted">Failed to load agents.</p>
        ) : null}
        {orderedNodes.length === 0 ? (
          <p className="muted">
            Add at least one AGENT step. Node keys stay stable when you reorder
            steps.
          </p>
        ) : null}
        <div className="stack">
          {orderedNodes.map((node, index) => (
            <AgentStepRow
              key={node.key}
              nodeKey={node.key}
              agentVersionId={node.agentVersionId}
              agents={agentsQuery.data?.agents ?? []}
              selectedAgentId={agentIdByNodeKey[node.key]}
              versionUnavailable={
                bindingResolution.unavailableVersionByNodeKey[node.key] === true
              }
              onAgentIdChange={(agentId) => {
                setManualAgentIdByNodeKey((current) => ({
                  ...current,
                  [node.key]: agentId,
                }));
                onDraftChange(
                  setAgentNodeVersion(draft, node.key, "" as AgentVersionId),
                );
              }}
              index={index}
              stepCount={orderedNodes.length}
              disabled={disabled}
              onVersionChange={(agentVersionId) =>
                onDraftChange(
                  setAgentNodeVersion(draft, node.key, agentVersionId),
                )
              }
              onMoveUp={() =>
                onDraftChange(moveAgentNode(draft, index, index - 1))
              }
              onMoveDown={() =>
                onDraftChange(moveAgentNode(draft, index, index + 1))
              }
              onRemove={() => {
                onDraftChange(removeAgentNode(draft, node.key));
                setManualAgentIdByNodeKey((current) => {
                  const next = { ...current };
                  delete next[node.key];
                  return next;
                });
              }}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

interface AgentStepRowProps {
  readonly nodeKey: string;
  readonly agentVersionId: string;
  readonly agents: readonly AgentResource[];
  readonly selectedAgentId: string | undefined;
  readonly versionUnavailable: boolean;
  readonly onAgentIdChange: (agentId: string) => void;
  readonly index: number;
  readonly stepCount: number;
  readonly disabled: boolean;
  readonly onVersionChange: (agentVersionId: AgentVersionId) => void;
  readonly onMoveUp: () => void;
  readonly onMoveDown: () => void;
  readonly onRemove: () => void;
}

function AgentStepRow({
  nodeKey,
  agentVersionId,
  agents,
  selectedAgentId,
  versionUnavailable,
  onAgentIdChange,
  index,
  stepCount,
  disabled,
  onVersionChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: AgentStepRowProps) {
  const versionsQuery = useAgentVersionsQuery(selectedAgentId);
  const versions = versionsQuery.data?.versions ?? [];
  const boundVersionListed = versions.some(
    (version) => version.id === agentVersionId,
  );
  const showUnavailableBinding =
    versionUnavailable ||
    (agentVersionId.trim().length > 0 &&
      selectedAgentId !== undefined &&
      !versionsQuery.isLoading &&
      !boundVersionListed);

  return (
    <div className="panel" style={{ padding: 12 }}>
      <div className="page-header" style={{ marginBottom: 8 }}>
        <strong className="mono">{nodeKey}</strong>
        <div className="stack" style={{ flexDirection: "row", gap: 8 }}>
          <button
            type="button"
            className="button"
            disabled={disabled || index === 0}
            onClick={onMoveUp}
          >
            Up
          </button>
          <button
            type="button"
            className="button"
            disabled={disabled || index >= stepCount - 1}
            onClick={onMoveDown}
          >
            Down
          </button>
          <button
            type="button"
            className="button"
            disabled={disabled}
            onClick={onRemove}
          >
            Remove
          </button>
        </div>
      </div>
      <div className="stack">
        <div className="field">
          <label htmlFor={`agent-${nodeKey}`}>Agent</label>
          <select
            id={`agent-${nodeKey}`}
            value={selectedAgentId ?? ""}
            disabled={disabled}
            onChange={(event) => onAgentIdChange(event.target.value)}
          >
            <option value="">Select agent…</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} ({agent.key})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`version-${nodeKey}`}>
            Agent version (immutable)
          </label>
          <select
            id={`version-${nodeKey}`}
            value={agentVersionId}
            disabled={
              disabled ||
              selectedAgentId === undefined ||
              showUnavailableBinding
            }
            onChange={(event) =>
              onVersionChange(event.target.value as AgentVersionId)
            }
          >
            <option value="">Select version…</option>
            {versions.map((version: AgentVersionResource) => (
              <option key={version.id} value={version.id}>
                v{version.version} — {version.id}
              </option>
            ))}
            {showUnavailableBinding && agentVersionId.trim().length > 0 ? (
              <option value={agentVersionId}>
                {agentVersionId} (unavailable in workspace)
              </option>
            ) : null}
          </select>
          {showUnavailableBinding ? (
            <p className="muted" style={{ fontSize: 12 }}>
              Bound version <span className="mono">{agentVersionId}</span> is
              not visible in this workspace. The binding is preserved; pick
              another agent and version to replace it.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
