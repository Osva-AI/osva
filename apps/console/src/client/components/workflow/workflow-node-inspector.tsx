import type {
  AgentVersionId,
  WorkflowDefinitionNodeV3,
  WorkflowDefinitionWaitConfigurationV3,
} from "@osva-ai/contracts";
import { WORKFLOW_V3_NODE_TYPES } from "@osva-ai/contracts";

import {
  useAgentVersionsQuery,
  useAgentsListQuery,
  type AgentResource,
  type AgentVersionResource,
} from "../../hooks/use-agents";
import type { WorkflowBuilderDraft } from "../../lib/workflow-builder-draft";
import type { WorkflowBuilderValidationIssue } from "../../lib/workflow-builder-validation";
import {
  outgoingTargets,
  removeWorkflowNode,
  setAgentNodeVersion,
  updateWorkflowNode,
} from "../../lib/workflow-builder-graph";

interface WorkflowNodeInspectorProps {
  readonly draft: WorkflowBuilderDraft;
  readonly nodeKey: string | undefined;
  readonly onDraftChange: (draft: WorkflowBuilderDraft) => void;
  readonly disabled: boolean;
  readonly agentIdByNodeKey: Readonly<Record<string, string>>;
  readonly unavailableVersionByNodeKey: Readonly<Record<string, boolean>>;
  readonly onManualAgentIdChange: (nodeKey: string, agentId: string) => void;
  readonly nodeIssues?: readonly WorkflowBuilderValidationIssue[];
}

export function WorkflowNodeInspector({
  draft,
  nodeKey,
  onDraftChange,
  disabled,
  agentIdByNodeKey,
  unavailableVersionByNodeKey,
  onManualAgentIdChange,
  nodeIssues = [],
}: WorkflowNodeInspectorProps) {
  if (nodeKey === undefined) {
    return (
      <p className="muted">
        Select a node on the canvas or in the list below to edit its
        configuration.
      </p>
    );
  }

  const node = draft.definition.nodes.find(
    (candidate) => candidate.key === nodeKey,
  );
  if (node === undefined) {
    return <p className="muted">Node {nodeKey} is not in the draft.</p>;
  }

  return (
    <div className="stack">
      <div className="page-header">
        <strong className="mono">
          {node.key} · {node.type}
        </strong>
        <button
          type="button"
          className="button"
          disabled={disabled}
          onClick={() => onDraftChange(removeWorkflowNode(draft, node.key))}
        >
          Remove node
        </button>
      </div>
      {nodeIssues.length > 0 ? (
        <ul
          className="workflow-inspector-errors"
          data-testid="workflow-inspector-errors"
        >
          {nodeIssues.map((item) => (
            <li key={item.id}>{item.message}</li>
          ))}
        </ul>
      ) : null}
      {node.type === "AGENT" ? (
        <AgentNodeInspector
          node={node}
          disabled={disabled}
          selectedAgentId={agentIdByNodeKey[node.key]}
          versionUnavailable={unavailableVersionByNodeKey[node.key] === true}
          onAgentIdChange={(agentId) =>
            onManualAgentIdChange(node.key, agentId)
          }
          onVersionChange={(agentVersionId) =>
            onDraftChange(setAgentNodeVersion(draft, node.key, agentVersionId))
          }
        />
      ) : null}
      {node.type === "BRANCH" ? (
        <BranchNodeInspector
          node={node}
          draft={draft}
          disabled={disabled}
          onDraftChange={onDraftChange}
        />
      ) : null}
      {node.type === "APPROVAL" ? (
        <ApprovalNodeInspector
          node={node}
          disabled={disabled}
          onChange={(next) =>
            onDraftChange(updateWorkflowNode(draft, node.key, next))
          }
        />
      ) : null}
      {node.type === "WAIT" ? (
        <WaitNodeInspector
          node={node}
          disabled={disabled}
          onChange={(next) =>
            onDraftChange(updateWorkflowNode(draft, node.key, next))
          }
        />
      ) : null}
      {node.type === "PARALLEL" || node.type === "JOIN" ? (
        <p className="muted">
          Connect edges on the canvas. {node.type} requires valid fan-out/fan-in
          degree before publish.
        </p>
      ) : null}
    </div>
  );
}

export function WorkflowNodePalette({
  disabled,
  onAddNode,
}: {
  readonly disabled: boolean;
  readonly onAddNode: (type: (typeof WORKFLOW_V3_NODE_TYPES)[number]) => void;
}) {
  return (
    <div className="toolbar" role="group" aria-label="Add workflow node">
      {WORKFLOW_V3_NODE_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          className="button"
          disabled={disabled}
          onClick={() => onAddNode(type)}
        >
          Add {type}
        </button>
      ))}
    </div>
  );
}

function AgentNodeInspector({
  node,
  disabled,
  selectedAgentId,
  versionUnavailable,
  onAgentIdChange,
  onVersionChange,
}: {
  readonly node: Extract<WorkflowDefinitionNodeV3, { type: "AGENT" }>;
  readonly disabled: boolean;
  readonly selectedAgentId: string | undefined;
  readonly versionUnavailable: boolean;
  readonly onAgentIdChange: (agentId: string) => void;
  readonly onVersionChange: (agentVersionId: AgentVersionId) => void;
}) {
  const agentsQuery = useAgentsListQuery();
  const versionsQuery = useAgentVersionsQuery(selectedAgentId);
  const agents = agentsQuery.data?.agents ?? [];
  const versions = versionsQuery.data?.versions ?? [];
  const boundVersionListed = versions.some(
    (version) => version.id === node.agentVersionId,
  );
  const showUnavailableBinding =
    versionUnavailable ||
    (node.agentVersionId.trim().length > 0 &&
      selectedAgentId !== undefined &&
      !versionsQuery.isLoading &&
      !boundVersionListed);

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor={`agent-${node.key}`}>Agent</label>
        <select
          id={`agent-${node.key}`}
          value={selectedAgentId ?? ""}
          disabled={disabled}
          onChange={(event) => onAgentIdChange(event.target.value)}
        >
          <option value="">Select agent…</option>
          {agents.map((agent: AgentResource) => (
            <option key={agent.id} value={agent.id}>
              {agent.name} ({agent.key})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`version-${node.key}`}>Agent version (immutable)</label>
        <select
          id={`version-${node.key}`}
          value={node.agentVersionId}
          disabled={
            disabled || selectedAgentId === undefined || showUnavailableBinding
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
          {showUnavailableBinding && node.agentVersionId.trim().length > 0 ? (
            <option value={node.agentVersionId}>
              {node.agentVersionId} (unavailable in workspace)
            </option>
          ) : null}
        </select>
        {showUnavailableBinding ? (
          <p className="muted" style={{ fontSize: 12 }}>
            Bound version <span className="mono">{node.agentVersionId}</span> is
            not visible in this workspace. The binding is preserved; pick
            another agent and version to replace it.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function BranchNodeInspector({
  node,
  draft,
  disabled,
  onDraftChange,
}: {
  readonly node: Extract<WorkflowDefinitionNodeV3, { type: "BRANCH" }>;
  readonly draft: WorkflowBuilderDraft;
  readonly disabled: boolean;
  readonly onDraftChange: (draft: WorkflowBuilderDraft) => void;
}) {
  const targets = outgoingTargets(draft, node.key);

  function patchBranch(
    patch: Partial<Extract<WorkflowDefinitionNodeV3, { type: "BRANCH" }>>,
  ) {
    onDraftChange(
      updateWorkflowNode(draft, node.key, {
        ...node,
        ...patch,
      }),
    );
  }

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor={`branch-selector-${node.key}`}>
          Selector (JSON Pointer)
        </label>
        <input
          id={`branch-selector-${node.key}`}
          value={node.selector}
          disabled={disabled}
          onChange={(event) => patchBranch({ selector: event.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor={`branch-default-${node.key}`}>Default target</label>
        <select
          id={`branch-default-${node.key}`}
          value={node.defaultTo}
          disabled={disabled}
          onChange={(event) => patchBranch({ defaultTo: event.target.value })}
        >
          <option value="">Select outgoing target…</option>
          {targets.map((target) => (
            <option key={target} value={target}>
              {target}
            </option>
          ))}
        </select>
      </div>
      <div>
        <div className="page-header">
          <strong>Cases</strong>
          <button
            type="button"
            className="button"
            disabled={disabled || targets.length === 0}
            onClick={() =>
              patchBranch({
                cases: [...node.cases, { equals: "", to: targets[0] ?? "" }],
              })
            }
          >
            Add case
          </button>
        </div>
        <div className="stack">
          {node.cases.map((branchCase, index) => (
            <div key={`${node.key}-case-${index}`} className="field">
              <label>Case {index + 1}</label>
              <div className="stack" style={{ flexDirection: "row", gap: 8 }}>
                <input
                  aria-label={`Case ${index + 1} equals`}
                  value={String(branchCase.equals)}
                  disabled={disabled}
                  onChange={(event) => {
                    const cases = [...node.cases];
                    cases[index] = {
                      ...branchCase,
                      equals: event.target.value,
                    };
                    patchBranch({ cases });
                  }}
                />
                <select
                  aria-label={`Case ${index + 1} target`}
                  value={branchCase.to}
                  disabled={disabled}
                  onChange={(event) => {
                    const cases = [...node.cases];
                    cases[index] = { ...branchCase, to: event.target.value };
                    patchBranch({ cases });
                  }}
                >
                  {targets.map((target) => (
                    <option key={target} value={target}>
                      {target}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button"
                  disabled={disabled}
                  onClick={() => {
                    const cases = node.cases.filter(
                      (_, caseIndex) => caseIndex !== index,
                    );
                    patchBranch({ cases });
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ApprovalNodeInspector({
  node,
  disabled,
  onChange,
}: {
  readonly node: Extract<WorkflowDefinitionNodeV3, { type: "APPROVAL" }>;
  readonly disabled: boolean;
  readonly onChange: (
    node: Extract<WorkflowDefinitionNodeV3, { type: "APPROVAL" }>,
  ) => void;
}) {
  return (
    <div className="stack">
      <div className="field">
        <label htmlFor={`approval-title-${node.key}`}>Title</label>
        <input
          id={`approval-title-${node.key}`}
          value={node.title}
          disabled={disabled}
          onChange={(event) => onChange({ ...node, title: event.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor={`approval-desc-${node.key}`}>
          Description (optional)
        </label>
        <textarea
          id={`approval-desc-${node.key}`}
          rows={2}
          value={node.description ?? ""}
          disabled={disabled}
          onChange={(event) => {
            const description = event.target.value.trim();
            onChange({
              ...node,
              ...(description.length > 0 ? { description } : {}),
            });
          }}
        />
      </div>
    </div>
  );
}

function WaitNodeInspector({
  node,
  disabled,
  onChange,
}: {
  readonly node: Extract<WorkflowDefinitionNodeV3, { type: "WAIT" }>;
  readonly disabled: boolean;
  readonly onChange: (
    node: Extract<WorkflowDefinitionNodeV3, { type: "WAIT" }>,
  ) => void;
}) {
  const wait = node.wait;

  function setWait(next: WorkflowDefinitionWaitConfigurationV3) {
    onChange({ ...node, wait: next });
  }

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor={`wait-kind-${node.key}`}>Wait kind</label>
        <select
          id={`wait-kind-${node.key}`}
          value={wait.kind}
          disabled={disabled}
          onChange={(event) => {
            const kind = event.target.value;
            if (kind === "DURATION") {
              setWait({ kind: "DURATION", durationMs: 60_000 });
            } else if (kind === "UNTIL") {
              setWait({ kind: "UNTIL", until: "2026-01-01T00:00:00.000Z" });
            } else {
              setWait({
                kind: "EVENT",
                source: "external",
                eventType: "event.type",
                correlation: { kind: "LITERAL", value: "correlation-id" },
              });
            }
          }}
        >
          <option value="DURATION">DURATION</option>
          <option value="UNTIL">UNTIL</option>
          <option value="EVENT">EVENT</option>
        </select>
      </div>
      {wait.kind === "DURATION" ? (
        <div className="field">
          <label htmlFor={`wait-duration-${node.key}`}>durationMs</label>
          <input
            id={`wait-duration-${node.key}`}
            type="number"
            min={1}
            value={wait.durationMs}
            disabled={disabled}
            onChange={(event) =>
              setWait({
                kind: "DURATION",
                durationMs: Number.parseInt(event.target.value, 10) || 1,
              })
            }
          />
        </div>
      ) : null}
      {wait.kind === "UNTIL" ? (
        <div className="field">
          <label htmlFor={`wait-until-${node.key}`}>until (UTC ISO-8601)</label>
          <input
            id={`wait-until-${node.key}`}
            value={wait.until}
            disabled={disabled}
            onChange={(event) =>
              setWait({ kind: "UNTIL", until: event.target.value })
            }
          />
        </div>
      ) : null}
      {wait.kind === "EVENT" ? (
        <>
          <div className="field">
            <label htmlFor={`wait-source-${node.key}`}>source</label>
            <input
              id={`wait-source-${node.key}`}
              value={wait.source}
              disabled={disabled}
              onChange={(event) =>
                setWait({ ...wait, source: event.target.value })
              }
            />
          </div>
          <div className="field">
            <label htmlFor={`wait-event-type-${node.key}`}>eventType</label>
            <input
              id={`wait-event-type-${node.key}`}
              value={wait.eventType}
              disabled={disabled}
              onChange={(event) =>
                setWait({ ...wait, eventType: event.target.value })
              }
            />
          </div>
          <div className="field">
            <label htmlFor={`wait-corr-kind-${node.key}`}>
              Correlation kind
            </label>
            <select
              id={`wait-corr-kind-${node.key}`}
              value={wait.correlation.kind}
              disabled={disabled}
              onChange={(event) => {
                if (event.target.value === "LITERAL") {
                  setWait({
                    ...wait,
                    correlation: { kind: "LITERAL", value: "value" },
                  });
                } else {
                  setWait({
                    ...wait,
                    correlation: { kind: "INPUT_POINTER", pointer: "/id" },
                  });
                }
              }}
            >
              <option value="LITERAL">LITERAL</option>
              <option value="INPUT_POINTER">INPUT_POINTER</option>
            </select>
          </div>
          {wait.correlation.kind === "LITERAL" ? (
            <div className="field">
              <label htmlFor={`wait-corr-value-${node.key}`}>
                Correlation value
              </label>
              <input
                id={`wait-corr-value-${node.key}`}
                value={wait.correlation.value}
                disabled={disabled}
                onChange={(event) =>
                  setWait({
                    ...wait,
                    correlation: {
                      kind: "LITERAL",
                      value: event.target.value,
                    },
                  })
                }
              />
            </div>
          ) : (
            <div className="field">
              <label htmlFor={`wait-corr-pointer-${node.key}`}>
                Correlation pointer
              </label>
              <input
                id={`wait-corr-pointer-${node.key}`}
                value={wait.correlation.pointer}
                disabled={disabled}
                onChange={(event) =>
                  setWait({
                    ...wait,
                    correlation: {
                      kind: "INPUT_POINTER",
                      pointer: event.target.value,
                    },
                  })
                }
              />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
