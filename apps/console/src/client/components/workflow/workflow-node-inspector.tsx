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
  BRANCH_SELECTOR_PRESETS,
  branchCaseValueKind,
  formatBranchCaseForInput,
  parseBranchCaseInput,
  type BranchCaseValueKind,
} from "../../lib/workflow-branch-case";
import type { WorkflowCanvasLabelContext } from "../../lib/workflow-canvas-labels";
import { resolveWorkflowCanvasLabel } from "../../lib/workflow-canvas-labels";
import {
  outgoingTargets,
  removeWorkflowNode,
  setAgentNodeVersion,
  updateWorkflowNode,
} from "../../lib/workflow-builder-graph";
import { workflowNodePresentation } from "../../lib/workflow-node-catalog";
import {
  durationMsToMinutes,
  localDatetimeInputValueFromUtcIso,
  minutesToDurationMs,
  utcIsoFromLocalDatetimeInput,
} from "../../lib/workflow-wait-editor";

interface WorkflowNodeInspectorProps {
  readonly draft: WorkflowBuilderDraft;
  readonly nodeKey: string | undefined;
  readonly onDraftChange: (draft: WorkflowBuilderDraft) => void;
  readonly disabled: boolean;
  readonly showAdvanced: boolean;
  readonly agentIdByNodeKey: Readonly<Record<string, string>>;
  readonly unavailableVersionByNodeKey: Readonly<Record<string, boolean>>;
  readonly canvasLabelContext: WorkflowCanvasLabelContext;
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
  canvasLabelContext,
  showAdvanced,
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

  const presentation = workflowNodePresentation(node.type);
  const canvasLabel = resolveWorkflowCanvasLabel(node, canvasLabelContext);

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <strong>{presentation.label}</strong>
          <p className="muted">{canvasLabel}</p>
          {showAdvanced ? (
            <p className="mono">
              {node.key} · {node.type}
            </p>
          ) : null}
        </div>
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
      {node.type === "PARALLEL" ? (
        <ParallelJoinGuidance
          nodeType="PARALLEL"
          nodeKey={node.key}
          draft={draft}
        />
      ) : null}
      {node.type === "JOIN" ? (
        <ParallelJoinGuidance
          nodeType="JOIN"
          nodeKey={node.key}
          draft={draft}
        />
      ) : null}
      {node.type === "AGENT" ? (
        <p className="muted">
          This step receives the previous step&apos;s output automatically (or
          the workflow run input when it is the first step).
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
          Add {workflowNodePresentation(type).paletteLabel}
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
              Version {version.version}
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
      {node.agentVersionId.trim().length > 0 ? (
        <p className="muted">
          Canonical binding: <span className="mono">{node.agentVersionId}</span>
        </p>
      ) : null}
    </div>
  );
}

function ParallelJoinGuidance({
  nodeType,
  nodeKey,
  draft,
}: {
  readonly nodeType: "PARALLEL" | "JOIN";
  readonly nodeKey: string;
  readonly draft: WorkflowBuilderDraft;
}) {
  const outgoing = outgoingTargets(draft, nodeKey);
  const incomingCount = draft.definition.edges.filter(
    (edge) => edge.to === nodeKey,
  ).length;
  const outgoingCount = outgoing.length;

  if (nodeType === "PARALLEL") {
    return (
      <div className="stack">
        <p className="muted">
          <strong>Run steps together</strong> starts multiple paths at once.
          Connect exactly one incoming edge into this fork, then connect two or
          more outgoing edges to the parallel steps.
        </p>
        <p className="muted">
          Incoming: {incomingCount}. Outgoing: {outgoingCount}.
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="muted">
        <strong>Merge parallel paths</strong> waits for connected parallel
        branches to finish, then passes their outputs to the next step. Connect
        one or more incoming edges from parallel paths and one outgoing edge to
        continue.
      </p>
      <p className="muted">
        Incoming: {incomingCount}. Outgoing: {outgoingCount}.
      </p>
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
      <p className="muted">
        Compares a field on the previous step&apos;s JSON output using a JSON
        Pointer (for example <span className="mono">/status</span>).
      </p>
      <div className="field">
        <label htmlFor={`branch-preset-${node.key}`}>Common fields</label>
        <select
          id={`branch-preset-${node.key}`}
          value=""
          disabled={disabled}
          onChange={(event) => {
            const preset = BRANCH_SELECTOR_PRESETS.find(
              (entry) => entry.pointer === event.target.value,
            );
            if (preset !== undefined) {
              patchBranch({ selector: preset.pointer });
            }
          }}
        >
          <option value="">Choose a preset…</option>
          {BRANCH_SELECTOR_PRESETS.map((preset) => (
            <option key={preset.pointer} value={preset.pointer}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`branch-selector-${node.key}`}>
          Field to check (JSON Pointer)
        </label>
        <input
          id={`branch-selector-${node.key}`}
          value={node.selector}
          disabled={disabled}
          onChange={(event) => patchBranch({ selector: event.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor={`branch-default-${node.key}`}>
          Otherwise go to step
        </label>
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
            Add rule
          </button>
        </div>
        <div className="stack">
          {node.cases.map((branchCase, index) => {
            const valueKind = branchCaseValueKind(branchCase.equals);
            return (
              <div key={`${node.key}-case-${index}`} className="field">
                <label>Rule {index + 1}</label>
                <div className="stack" style={{ flexDirection: "row", gap: 8 }}>
                  <select
                    aria-label={`Rule ${index + 1} value type`}
                    value={valueKind}
                    disabled={disabled}
                    onChange={(event) => {
                      const kind = event.target.value as BranchCaseValueKind;
                      const parsed =
                        kind === "null"
                          ? null
                          : (parseBranchCaseInput("", kind) ?? "");
                      const cases = [...node.cases];
                      cases[index] = { ...branchCase, equals: parsed };
                      patchBranch({ cases });
                    }}
                  >
                    <option value="string">Text</option>
                    <option value="number">Number</option>
                    <option value="boolean">Yes/No</option>
                    <option value="null">Empty (null)</option>
                  </select>
                  {valueKind === "boolean" ? (
                    <select
                      aria-label={`Rule ${index + 1} value`}
                      value={formatBranchCaseForInput(branchCase.equals)}
                      disabled={disabled}
                      onChange={(event) => {
                        const parsed = parseBranchCaseInput(
                          event.target.value,
                          "boolean",
                        );
                        if (parsed === undefined) {
                          return;
                        }
                        const cases = [...node.cases];
                        cases[index] = { ...branchCase, equals: parsed };
                        patchBranch({ cases });
                      }}
                    >
                      <option value="true">Yes (true)</option>
                      <option value="false">No (false)</option>
                    </select>
                  ) : valueKind === "null" ? (
                    <span className="muted">null</span>
                  ) : (
                    <input
                      aria-label={`Rule ${index + 1} value`}
                      value={formatBranchCaseForInput(branchCase.equals)}
                      disabled={disabled}
                      onChange={(event) => {
                        const parsed = parseBranchCaseInput(
                          event.target.value,
                          valueKind,
                        );
                        if (parsed === undefined) {
                          return;
                        }
                        const cases = [...node.cases];
                        cases[index] = { ...branchCase, equals: parsed };
                        patchBranch({ cases });
                      }}
                    />
                  )}
                  <select
                    aria-label={`Rule ${index + 1} target step`}
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
            );
          })}
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
      <p className="muted">
        Operators with execute permission approve or reject while the workflow
        is paused. Workers are not kept alive during the wait.
      </p>
      <div className="field">
        <label htmlFor={`approval-title-${node.key}`}>Approval title</label>
        <input
          id={`approval-title-${node.key}`}
          value={node.title}
          disabled={disabled}
          onChange={(event) => onChange({ ...node, title: event.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor={`approval-desc-${node.key}`}>
          Instructions for reviewers (optional)
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
      <p className="muted">
        The workflow pauses here until the timer completes or the configured
        event is received. Execution resumes automatically afterward.
      </p>
      <div className="field">
        <label htmlFor={`wait-kind-${node.key}`}>Wait type</label>
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
          <option value="DURATION">Wait for a duration</option>
          <option value="UNTIL">Wait until a date and time</option>
          <option value="EVENT">Wait for an external event</option>
        </select>
      </div>
      {wait.kind === "DURATION" ? (
        <div className="field">
          <label htmlFor={`wait-duration-${node.key}`}>Minutes</label>
          <input
            id={`wait-duration-${node.key}`}
            type="number"
            min={1}
            value={durationMsToMinutes(wait.durationMs)}
            disabled={disabled}
            onChange={(event) =>
              setWait({
                kind: "DURATION",
                durationMs: minutesToDurationMs(
                  Number.parseInt(event.target.value, 10) || 1,
                ),
              })
            }
          />
        </div>
      ) : null}
      {wait.kind === "UNTIL" ? (
        <div className="stack">
          <div className="field">
            <label htmlFor={`wait-until-local-${node.key}`}>
              Date and time (local)
            </label>
            <input
              id={`wait-until-local-${node.key}`}
              type="datetime-local"
              value={localDatetimeInputValueFromUtcIso(wait.until)}
              disabled={disabled}
              onChange={(event) => {
                const iso = utcIsoFromLocalDatetimeInput(event.target.value);
                if (iso !== undefined) {
                  setWait({ kind: "UNTIL", until: iso });
                }
              }}
            />
          </div>
          <p className="muted mono">Stored as UTC: {wait.until}</p>
        </div>
      ) : null}
      {wait.kind === "EVENT" ? (
        <>
          <div className="field">
            <label htmlFor={`wait-source-${node.key}`}>Event source</label>
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
            <label htmlFor={`wait-event-type-${node.key}`}>Event type</label>
            <input
              id={`wait-event-type-${node.key}`}
              value={wait.eventType}
              disabled={disabled}
              onChange={(event) =>
                setWait({ ...wait, eventType: event.target.value })
              }
            />
          </div>
          <p className="muted">
            When a matching workflow event is ingested with the same source,
            type, and correlation, this wait completes and the workflow
            continues.
          </p>
          <div className="field">
            <label htmlFor={`wait-corr-kind-${node.key}`}>
              Match events by
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
              <option value="LITERAL">Fixed correlation value</option>
              <option value="INPUT_POINTER">
                Value from workflow run input (JSON Pointer)
              </option>
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
