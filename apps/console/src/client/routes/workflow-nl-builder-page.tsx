import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { Link } from "react-router-dom";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";

import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { useModelProfilesWithVersionsQuery } from "../hooks/use-model-profiles";
import { consoleFetch } from "../lib/console-api";
import {
  loadBuilderNlDraft,
  saveBuilderNlDraft,
  type BuilderNlDraftEnvelopeV1,
} from "../lib/builder-nl-draft-storage";
import { builderProposalWorkflowToFlowModel } from "../lib/builder-proposal-graph-adapter";
import { workflowGraphNodeTypes } from "../components/workflow/workflow-graph-node";

import "@xyflow/react/dist/style.css";

const EXAMPLE_PROMPTS = [
  "Build a research workflow: one agent gathers sources, two agents analyze in parallel, then join and human approval before a final report agent.",
  "Create a simple sequential pipeline: triage → specialist → summary.",
];

type BuilderProposalLike = {
  workflowRegistry?: { key?: string; name?: string; description?: string };
  workflow?: { nodes?: unknown[]; edges?: unknown[] };
  agents?: unknown[];
  assumptions?: string[];
  unresolvedRequirements?: string[];
};

export function WorkflowNlBuilderPage() {
  const auth = useAuthContextQuery();
  const workspaceId = auth.data?.workspaceId;
  const modelQuery = useModelProfilesWithVersionsQuery();

  const [instruction, setInstruction] = useState("");
  const [generationModelProfileVersionId, setGenerationModelProfileVersionId] =
    useState<string | undefined>(undefined);
  const [proposal, setProposal] = useState<BuilderProposalLike | null>(null);
  const [compileIssues, setCompileIssues] = useState<unknown[]>([]);
  const [validation, setValidation] = useState<unknown>(undefined);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | undefined>(
    undefined,
  );
  const [generateState, setGenerateState] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [abortController, setAbortController] = useState<
    AbortController | undefined
  >(undefined);
  const [validateState, setValidateState] = useState<"idle" | "loading">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string | undefined>(
    undefined,
  );
  /** False until session draft is read for `workspaceId`, so we do not overwrite storage on first paint. */
  const [draftHydrated, setDraftHydrated] = useState(false);

  useLayoutEffect(() => {
    if (workspaceId === undefined) {
      setDraftHydrated(false);
      return;
    }
    const restored = loadBuilderNlDraft(workspaceId);
    if (restored === undefined) {
      setInstruction("");
      setGenerationModelProfileVersionId(undefined);
      setProposal(null);
      setSelectedNodeKey(undefined);
      setValidation(undefined);
    } else {
      setInstruction(restored.instruction);
      setGenerationModelProfileVersionId(
        restored.generationModelProfileVersionId,
      );
      setProposal(restored.proposal as BuilderProposalLike | null);
      setSelectedNodeKey(restored.selectedNodeKey);
      setValidation(restored.validation);
    }
    setDraftHydrated(true);
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceId === undefined || !draftHydrated) {
      return;
    }
    const envelope: BuilderNlDraftEnvelopeV1 = {
      schemaVersion: "1",
      workspaceId,
      updatedAt: new Date().toISOString(),
      instruction,
      generationModelProfileVersionId,
      proposal,
      selectedNodeKey,
      validation,
    };
    saveBuilderNlDraft(envelope);
  }, [
    workspaceId,
    draftHydrated,
    instruction,
    generationModelProfileVersionId,
    proposal,
    selectedNodeKey,
    validation,
  ]);

  const flow = useMemo(() => {
    if (
      proposal === null ||
      proposal.workflow === undefined ||
      !Array.isArray(proposal.workflow.nodes) ||
      !Array.isArray(proposal.workflow.edges)
    ) {
      return undefined;
    }
    return builderProposalWorkflowToFlowModel({
      workflow: {
        nodes: proposal.workflow.nodes as Record<string, unknown>[],
        edges: proposal.workflow.edges as {
          readonly from: string;
          readonly to: string;
        }[],
      },
      agents: Array.isArray(proposal.agents)
        ? (proposal.agents as Record<string, unknown>[])
        : [],
    });
  }, [proposal]);

  const selectedNode = useMemo(() => {
    if (
      proposal?.workflow?.nodes === undefined ||
      selectedNodeKey === undefined
    ) {
      return undefined;
    }
    const nodes = proposal.workflow.nodes as { key?: string }[];
    return nodes.find((n) => n.key === selectedNodeKey);
  }, [proposal, selectedNodeKey]);

  const patchRegistryField = useCallback(
    (field: "key" | "name" | "description", value: string) => {
      setProposal((prev) => {
        if (prev === null) {
          return prev;
        }
        const next = structuredClone(prev) as BuilderProposalLike;
        next.workflowRegistry = {
          ...(next.workflowRegistry ?? {}),
          [field]: value,
        };
        return next;
      });
    },
    [],
  );

  const patchNewAgentField = useCallback(
    (
      ref: string,
      field: "agentName" | "agentKey" | "instructions",
      value: string,
    ) => {
      setProposal((prev) => {
        if (prev === null || !Array.isArray(prev.agents)) {
          return prev;
        }
        const next = structuredClone(prev) as BuilderProposalLike;
        const agents = next.agents as Record<string, unknown>[];
        const idx = agents.findIndex((a) => a.ref === ref && a.kind === "NEW");
        if (idx < 0) {
          return prev;
        }
        agents[idx] = { ...agents[idx], [field]: value };
        next.agents = agents;
        return next;
      });
    },
    [],
  );

  const handleGenerate = async () => {
    if (workspaceId === undefined) {
      return;
    }
    abortController?.abort();
    const ac = new AbortController();
    setAbortController(ac);
    setGenerateState("loading");
    setErrorMessage(undefined);
    setCompileIssues([]);
    setValidation(undefined);
    try {
      const body: Record<string, unknown> = {
        userInstruction: instruction,
      };
      if (generationModelProfileVersionId !== undefined) {
        body.generationModelProfileVersionId = generationModelProfileVersionId;
      }
      const out = await consoleFetch<Record<string, unknown>>(
        "/api/v1/builder/proposals/generate",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: ac.signal,
        },
        { acceptErrorStatuses: [422] },
      );
      const ok = out.ok === true;
      const proposalPayload = out.proposal as BuilderProposalLike | undefined;
      if (ok && proposalPayload !== undefined) {
        setProposal(proposalPayload);
        setCompileIssues(
          Array.isArray(out.compileIssues) ? out.compileIssues : [],
        );
      } else {
        setProposal(null);
        setErrorMessage(
          typeof out.message === "string" ? out.message : "Generation failed.",
        );
      }
      setGenerateState("idle");
      setAbortController(undefined);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        setGenerateState("idle");
        setAbortController(undefined);
        return;
      }
      setGenerateState("error");
      if (e instanceof Error) {
        setErrorMessage(e.message);
      } else {
        setErrorMessage("Generation failed.");
      }
      setAbortController(undefined);
    }
  };

  const handleCancelGenerate = () => {
    abortController?.abort();
  };

  const handleValidate = async () => {
    if (proposal === null || workspaceId === undefined) {
      return;
    }
    setValidateState("loading");
    try {
      const out = await consoleFetch<unknown>(
        "/api/v1/builder/proposals/validate",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proposal }),
        },
      );
      setValidation(out);
      setValidateState("idle");
    } catch {
      setValidateState("idle");
    }
  };

  if (auth.isLoading || workspaceId === undefined || !draftHydrated) {
    return <LoadingBlock label="Loading…" />;
  }

  const modelOptions =
    modelQuery.data?.flatMap((entry) =>
      entry.versions.map((v) => ({
        id: v.id,
        label: `${entry.profile.name} v${String(v.version)} (${v.provider} · ${v.model})`,
        provider: v.provider,
      })),
    ) ?? [];

  const openAiGeminiOptions = modelOptions.filter(
    (o) => o.provider === "OPENAI" || o.provider === "GOOGLE_GEMINI",
  );

  return (
    <div className="workflow-nl-builder">
      <header className="page-header">
        <div>
          <h1 className="page-title">Describe with AI</h1>
          <p className="page-subtitle">
            Generate an editable workflow builder proposal from natural
            language. This creates a <strong>draft</strong> only — nothing is
            published or executed (publication is a later milestone).
          </p>
        </div>
        <div
          className="stack"
          style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}
        >
          <Link className="button" to="/workflows">
            All workflows
          </Link>
          <Link className="button" to="/workflows/new">
            Classic builder
          </Link>
        </div>
      </header>

      {modelQuery.isError ? (
        <ErrorState
          title="Failed to load model profiles"
          error={modelQuery.error}
        />
      ) : null}

      <div className="workflow-nl-builder__grid">
        <section
          className="panel workflow-nl-builder__panel"
          aria-label="Instructions"
        >
          <h2 className="panel-title">Instructions</h2>
          <label className="form-label" htmlFor="nl-instruction">
            What should this workflow do?
          </label>
          <textarea
            id="nl-instruction"
            className="input workflow-nl-builder__textarea"
            rows={8}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Describe roles, steps, branching, approvals, and outputs…"
          />
          <div
            className="workflow-nl-builder__examples"
            role="group"
            aria-label="Example prompts"
          >
            <span className="text-muted">Examples:</span>
            <ul className="workflow-nl-builder__example-list">
              {EXAMPLE_PROMPTS.map((ex) => (
                <li key={ex}>
                  <button
                    type="button"
                    className="button link-like"
                    onClick={() => setInstruction(ex)}
                  >
                    Use example
                  </button>
                  <span className="text-muted"> — {ex}</span>
                </li>
              ))}
            </ul>
          </div>

          <label className="form-label" htmlFor="nl-model">
            Generation model (workspace profile version)
          </label>
          {modelQuery.isLoading ? (
            <LoadingBlock label="Loading models…" />
          ) : (
            <select
              id="nl-model"
              className="input"
              value={generationModelProfileVersionId ?? ""}
              onChange={(e) =>
                setGenerationModelProfileVersionId(
                  e.target.value.length > 0 ? e.target.value : undefined,
                )
              }
            >
              <option value="">Select OpenAI or Gemini profile version…</option>
              {openAiGeminiOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          <p className="text-muted small">
            Only OpenAI and Gemini profiles support structured JSON generation
            in M20.2.
          </p>

          <div className="workflow-nl-builder__actions">
            <button
              type="button"
              className="button primary"
              disabled={
                generateState === "loading" ||
                instruction.trim().length === 0 ||
                generationModelProfileVersionId === undefined
              }
              onClick={() => void handleGenerate()}
            >
              {generateState === "loading" ? "Generating…" : "Generate draft"}
            </button>
            {generateState === "loading" ? (
              <button
                type="button"
                className="button"
                onClick={handleCancelGenerate}
              >
                Cancel
              </button>
            ) : null}
          </div>

          {errorMessage !== undefined ? (
            <p className="error-text" role="alert">
              {errorMessage}
            </p>
          ) : null}

          {proposal !== null ? (
            <>
              <h3
                className="workflow-nl-builder__subsection"
                data-testid="nl-proposed-agents"
              >
                Proposed agents
              </h3>
              <ul className="workflow-nl-builder__agent-list">
                {(proposal.agents ?? []).map((a, i) => {
                  const spec = a as Record<string, unknown>;
                  const ref = String(spec.ref ?? i);
                  const kind = spec.kind === "EXISTING" ? "EXISTING" : "NEW";
                  return (
                    <li key={ref}>
                      <span
                        className={`badge ${kind === "NEW" ? "badge--new" : "badge--existing"}`}
                      >
                        {kind}
                      </span>{" "}
                      <code>{ref}</code>
                      {kind === "NEW" ? (
                        <span className="text-muted">
                          {" "}
                          — {String(spec.agentName ?? "")}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              <h3 className="workflow-nl-builder__subsection">Assumptions</h3>
              {(proposal.assumptions ?? []).length === 0 ? (
                <p className="text-muted">None listed.</p>
              ) : (
                <ul>
                  {(proposal.assumptions ?? []).map((a) => (
                    <li key={String(a)}>{String(a)}</li>
                  ))}
                </ul>
              )}

              <h3 className="workflow-nl-builder__subsection">
                Unresolved requirements
              </h3>
              {(proposal.unresolvedRequirements ?? []).length === 0 ? (
                <p className="text-muted">None listed.</p>
              ) : (
                <ul>
                  {(proposal.unresolvedRequirements ?? []).map((a) => (
                    <li key={String(a)}>{String(a)}</li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </section>

        <section
          className="panel workflow-nl-builder__panel"
          aria-label="Graph preview"
        >
          <h2 className="panel-title">Workflow preview (draft)</h2>
          <p className="text-muted small">
            Logical topology only — <strong>not executable</strong>. Agent nodes
            use temporary <code>bpr_*</code> references until publication
            (M20.4).
          </p>
          {flow === undefined ? (
            <EmptyGraph />
          ) : (
            <div
              className="workflow-nl-builder__canvas"
              style={{ height: 420 }}
            >
              <ReactFlowProvider>
                <ReactFlow
                  nodes={flow.nodes.map((n) => ({
                    ...n,
                    selected: n.id === selectedNodeKey,
                  }))}
                  edges={flow.edges}
                  nodeTypes={workflowGraphNodeTypes}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable
                  fitView
                  onNodeClick={(_, node) => setSelectedNodeKey(node.id)}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background variant={BackgroundVariant.Dots} />
                  <Controls />
                </ReactFlow>
              </ReactFlowProvider>
            </div>
          )}

          <h3 className="workflow-nl-builder__subsection">
            Topological order (accessible)
          </h3>
          {proposal?.workflow?.nodes === undefined ? (
            <p className="text-muted">No nodes yet.</p>
          ) : (
            <ol className="workflow-nl-builder__node-order">
              {(
                proposal.workflow.nodes as { key?: string; type?: string }[]
              ).map((n) => (
                <li key={String(n.key)}>
                  <button
                    type="button"
                    className={`link-like ${selectedNodeKey === n.key ? "selected" : ""}`}
                    onClick={() => setSelectedNodeKey(n.key)}
                  >
                    {String(n.key)} — {String(n.type)}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section
          className="panel workflow-nl-builder__panel"
          aria-label="Inspect and edit"
        >
          <h2 className="panel-title">Draft details</h2>
          {proposal === null ? (
            <p className="text-muted">
              Generate a proposal to edit registry fields and agents.
            </p>
          ) : (
            <>
              <fieldset className="workflow-nl-builder__fieldset">
                <legend>Workflow registry</legend>
                <label className="form-label" htmlFor="reg-key">
                  Key
                </label>
                <input
                  id="reg-key"
                  className="input"
                  value={proposal.workflowRegistry?.key ?? ""}
                  onChange={(e) => patchRegistryField("key", e.target.value)}
                />
                <label className="form-label" htmlFor="reg-name">
                  Name
                </label>
                <input
                  id="reg-name"
                  className="input"
                  value={proposal.workflowRegistry?.name ?? ""}
                  onChange={(e) => patchRegistryField("name", e.target.value)}
                />
                <label className="form-label" htmlFor="reg-desc">
                  Description
                </label>
                <textarea
                  id="reg-desc"
                  className="input"
                  rows={3}
                  value={proposal.workflowRegistry?.description ?? ""}
                  onChange={(e) =>
                    patchRegistryField("description", e.target.value)
                  }
                />
              </fieldset>

              {selectedNode !== undefined &&
              (selectedNode as { type?: string }).type === "AGENT" ? (
                <AgentInspector
                  proposal={proposal}
                  node={selectedNode as Record<string, unknown>}
                  onPatchNew={patchNewAgentField}
                />
              ) : (
                <p className="text-muted">
                  Select an AGENT node in the graph or list to inspect bindings.
                </p>
              )}

              <div className="workflow-nl-builder__actions">
                <button
                  type="button"
                  className="button"
                  disabled={validateState === "loading"}
                  onClick={() => void handleValidate()}
                >
                  {validateState === "loading"
                    ? "Validating…"
                    : "Revalidate on server"}
                </button>
              </div>

              <ValidationPanel
                compileIssues={compileIssues}
                validation={validation}
              />

              <div className="callout callout--info" role="note">
                <strong>Publication disabled for M20.3.</strong> The next
                milestone will publish NEW agents and workflow versions from a
                validated proposal. This UI never calls publish or run APIs.
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function EmptyGraph() {
  return (
    <div className="empty-state workflow-nl-builder__empty-graph">
      <strong className="empty-state-title">No graph yet</strong>
      <p className="empty-state-description">
        Enter instructions, pick a generation model, and generate a draft.
      </p>
    </div>
  );
}

function AgentInspector(props: {
  readonly proposal: BuilderProposalLike;
  readonly node: Record<string, unknown>;
  readonly onPatchNew: (
    ref: string,
    field: "agentName" | "agentKey" | "instructions",
    value: string,
  ) => void;
}) {
  const ref =
    typeof props.node.agentRef === "string" ? props.node.agentRef : "";
  const spec = (
    props.proposal.agents as Record<string, unknown>[] | undefined
  )?.find((a) => a.ref === ref);
  if (spec === undefined) {
    return <p className="text-muted">Unknown agent reference.</p>;
  }
  if (spec.kind === "EXISTING") {
    return (
      <div className="workflow-nl-builder__inspector">
        <h3>Existing agent (immutable)</h3>
        <p>
          Bound to catalog version{" "}
          <code>{String(spec.agentVersionId ?? "")}</code>. You cannot change
          the published AgentVersion from the proposal editor.
        </p>
      </div>
    );
  }
  return (
    <fieldset className="workflow-nl-builder__fieldset">
      <legend>
        New agent <code>{ref}</code>
      </legend>
      <label className="form-label" htmlFor="ag-name">
        Name
      </label>
      <input
        id="ag-name"
        className="input"
        value={String(spec.agentName ?? "")}
        onChange={(e) => props.onPatchNew(ref, "agentName", e.target.value)}
      />
      <label className="form-label" htmlFor="ag-key">
        Key
      </label>
      <input
        id="ag-key"
        className="input"
        value={String(spec.agentKey ?? "")}
        onChange={(e) => props.onPatchNew(ref, "agentKey", e.target.value)}
      />
      <label className="form-label" htmlFor="ag-inst">
        Instructions
      </label>
      <textarea
        id="ag-inst"
        className="input"
        rows={5}
        value={String(spec.instructions ?? "")}
        onChange={(e) => props.onPatchNew(ref, "instructions", e.target.value)}
      />
    </fieldset>
  );
}

function ValidationPanel(props: {
  readonly compileIssues: unknown[];
  readonly validation: unknown;
}) {
  const v = props.validation as
    | {
        ok?: boolean;
        issues?: unknown[];
        previewLogicalWorkflowDigest?: string;
      }
    | undefined;
  return (
    <div className="workflow-nl-builder__validation">
      <h3>Issues</h3>
      {props.compileIssues.length > 0 ? (
        <ul>
          {props.compileIssues.map((issue, i) => (
            <li key={String(i)}>
              <pre className="mono small">{JSON.stringify(issue, null, 2)}</pre>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">No compiler issues from generation.</p>
      )}
      {v !== undefined ? (
        <>
          <p>
            Server validation:{" "}
            <strong>
              {v.ok === true ? "structurally valid" : "needs corrections"}
            </strong>
            {v.previewLogicalWorkflowDigest !== undefined ? (
              <>
                {" "}
                (digest{" "}
                <code className="mono">{v.previewLogicalWorkflowDigest}</code>)
              </>
            ) : null}
          </p>
          {(v.issues ?? []).length > 0 ? (
            <ul>
              {(v.issues ?? []).map((issue, i) => (
                <li key={String(i)}>
                  <pre className="mono small">
                    {JSON.stringify(issue, null, 2)}
                  </pre>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="text-muted">Run server validation after edits.</p>
      )}
    </div>
  );
}
