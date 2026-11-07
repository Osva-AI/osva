import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BuilderProposalChangesetV1 } from "@osva/domain/builder/changes";
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
  type BuilderNlAcceptedRevisionV1,
  type BuilderNlDraftEnvelopeV1,
} from "../lib/builder-nl-draft-storage";
import { digestBuilderDraftProposal } from "../lib/builder-proposal-digest-client";
import {
  canAcceptRefinementCandidate,
  shouldApplyRefinementResponse,
} from "../lib/builder-nl-refinement-coordination";
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
  const [publicationPlan, setPublicationPlan] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [publicationPhase, setPublicationPhase] = useState<
    | "idle"
    | "preparing"
    | "ready"
    | "publishing"
    | "published"
    | "conflict"
    | "unknown"
  >("idle");
  const [publicationConfirm, setPublicationConfirm] = useState(false);
  const [publicationReceipt, setPublicationReceipt] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [publicationIdempotencyKey, setPublicationIdempotencyKey] = useState(
    () =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `pub-${String(Date.now())}`,
  );
  const [errorMessage, setErrorMessage] = useState<string | undefined>(
    undefined,
  );
  const [refinementInstruction, setRefinementInstruction] = useState("");
  const [refineState, setRefineState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [refineAbortController, setRefineAbortController] = useState<
    AbortController | undefined
  >(undefined);
  const [candidateProposal, setCandidateProposal] =
    useState<BuilderProposalLike | null>(null);
  const [candidateChanges, setCandidateChanges] = useState<
    BuilderProposalChangesetV1 | undefined
  >(undefined);
  const [candidateCompileIssues, setCandidateCompileIssues] = useState<
    unknown[]
  >([]);
  const [candidateBaseProposalDigest, setCandidateBaseProposalDigest] =
    useState<string | undefined>(undefined);
  const [refineErrorMessage, setRefineErrorMessage] = useState<
    string | undefined
  >(undefined);
  const [acceptedRevisions, setAcceptedRevisions] = useState<
    readonly BuilderNlAcceptedRevisionV1[]
  >([]);
  const [conversationalHistory, setConversationalHistory] = useState<
    readonly string[]
  >([]);
  const refineRequestGen = useRef(0);
  const [proposalDigest, setProposalDigest] = useState<string | undefined>(
    undefined,
  );
  /** False until session draft is read for `workspaceId`, so we do not overwrite storage on first paint. */
  const [draftHydrated, setDraftHydrated] = useState(false);

  useEffect(() => {
    if (proposal === null) {
      setProposalDigest(undefined);
      return;
    }
    let cancelled = false;
    void digestBuilderDraftProposal(proposal).then((digest) => {
      if (!cancelled) {
        setProposalDigest(digest);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [proposal]);

  const publicationLocksDraft =
    publicationPhase === "publishing" ||
    publicationPhase === "unknown" ||
    publicationPhase === "published";

  const bumpRefineEpochForDraftMutation = useCallback(() => {
    refineRequestGen.current += 1;
    refineAbortController?.abort();
    setRefineState("idle");
    setRefineAbortController(undefined);
    setCandidateProposal(null);
    setCandidateChanges(undefined);
    setCandidateCompileIssues([]);
    setCandidateBaseProposalDigest(undefined);
  }, []);

  const invalidatePublicationPreflight = useCallback(() => {
    if (publicationPhase === "publishing" || publicationPhase === "unknown") {
      return;
    }
    if (publicationPhase === "published") {
      return;
    }
    setPublicationPlan(null);
    setPublicationConfirm(false);
    setPublicationPhase("idle");
    setPublicationIdempotencyKey(
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `pub-${String(Date.now())}`,
    );
    setValidation(undefined);
  }, [publicationPhase]);

  useLayoutEffect(() => {
    if (workspaceId === undefined) {
      setDraftHydrated(false);
      return;
    }
    refineRequestGen.current += 1;
    refineAbortController?.abort();
    setRefineState("idle");
    setCandidateProposal(null);
    setCandidateChanges(undefined);
    setCandidateBaseProposalDigest(undefined);
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
      if (typeof restored.publicationIdempotencyKey === "string") {
        setPublicationIdempotencyKey(restored.publicationIdempotencyKey);
      }
      if (
        restored.publicationReceipt !== undefined &&
        restored.publicationReceipt !== null &&
        typeof restored.publicationReceipt === "object"
      ) {
        setPublicationReceipt(
          restored.publicationReceipt as Record<string, unknown>,
        );
        setPublicationPhase("published");
      }
      if (Array.isArray(restored.acceptedRevisions)) {
        setAcceptedRevisions(restored.acceptedRevisions);
      }
      if (Array.isArray(restored.conversationalHistory)) {
        setConversationalHistory(restored.conversationalHistory);
      }
      if (
        restored.pendingCandidate !== undefined &&
        restored.proposal !== null
      ) {
        void digestBuilderDraftProposal(restored.proposal).then((digest) => {
          if (
            digest !== undefined &&
            digest === restored.pendingCandidate?.baseProposalDigest
          ) {
            setCandidateProposal(
              restored.pendingCandidate
                .candidateProposal as BuilderProposalLike,
            );
            setCandidateChanges(
              restored.pendingCandidate.changes as BuilderProposalChangesetV1,
            );
            setRefinementInstruction(
              restored.pendingCandidate.refinementInstruction,
            );
          }
        });
      }
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
      publicationIdempotencyKey,
      publicationReceipt,
      acceptedRevisions,
      conversationalHistory,
      pendingCandidate:
        candidateProposal !== null &&
        proposalDigest !== undefined &&
        refinementInstruction.trim().length > 0
          ? {
              candidateProposal,
              changes: candidateChanges,
              baseProposalDigest: proposalDigest,
              refinementInstruction,
            }
          : undefined,
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
    publicationIdempotencyKey,
    publicationReceipt,
    acceptedRevisions,
    conversationalHistory,
    candidateProposal,
    candidateChanges,
    refinementInstruction,
    proposalDigest,
  ]);

  const graphSource = candidateProposal !== null ? candidateProposal : proposal;

  const flow = useMemo(() => {
    if (
      graphSource === null ||
      graphSource.workflow === undefined ||
      !Array.isArray(graphSource.workflow.nodes) ||
      !Array.isArray(graphSource.workflow.edges)
    ) {
      return undefined;
    }
    return builderProposalWorkflowToFlowModel({
      workflow: {
        nodes: graphSource.workflow.nodes as Record<string, unknown>[],
        edges: graphSource.workflow.edges as {
          readonly from: string;
          readonly to: string;
        }[],
      },
      agents: Array.isArray(graphSource.agents)
        ? (graphSource.agents as Record<string, unknown>[])
        : [],
    });
  }, [graphSource]);

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
      if (publicationLocksDraft) {
        return;
      }
      bumpRefineEpochForDraftMutation();
      setProposal((prev) => {
        if (prev === null) {
          return prev;
        }
        const next = structuredClone(prev) as BuilderProposalLike;
        next.workflowRegistry = {
          ...(next.workflowRegistry ?? {}),
          [field]: value,
        };
        invalidatePublicationPreflight();
        return next;
      });
    },
    [
      bumpRefineEpochForDraftMutation,
      invalidatePublicationPreflight,
      publicationLocksDraft,
    ],
  );

  const patchNewAgentField = useCallback(
    (
      ref: string,
      field: "agentName" | "agentKey" | "instructions",
      value: string,
    ) => {
      if (publicationLocksDraft) {
        return;
      }
      bumpRefineEpochForDraftMutation();
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
        invalidatePublicationPreflight();
        return next;
      });
    },
    [
      bumpRefineEpochForDraftMutation,
      invalidatePublicationPreflight,
      publicationLocksDraft,
    ],
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
        setCandidateProposal(null);
        setCandidateChanges(undefined);
        setAcceptedRevisions([]);
        setConversationalHistory([]);
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

  const handleRefine = async () => {
    if (
      workspaceId === undefined ||
      proposal === null ||
      publicationLocksDraft
    ) {
      return;
    }
    if (proposalDigest === undefined) {
      setRefineErrorMessage(
        "Current draft is not structurally valid. Revalidate before refining.",
      );
      return;
    }
    refineRequestGen.current += 1;
    const requestGen = refineRequestGen.current;
    refineAbortController?.abort();
    const ac = new AbortController();
    setRefineAbortController(ac);
    setRefineState("loading");
    setRefineErrorMessage(undefined);
    const snapshotWorkspaceId = workspaceId;
    const snapshotBaseProposalDigest = proposalDigest;
    try {
      const body: Record<string, unknown> = {
        currentProposal: proposal,
        refinementInstruction,
        expectedBaseProposalDigest: proposalDigest,
        conversationalHistory,
      };
      if (generationModelProfileVersionId !== undefined) {
        body.generationModelProfileVersionId = generationModelProfileVersionId;
      }
      const out = await consoleFetch<Record<string, unknown>>(
        "/api/v1/builder/proposals/refine",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: ac.signal,
        },
        { acceptErrorStatuses: [422] },
      );
      if (
        !shouldApplyRefinementResponse({
          requestGen,
          currentRequestGen: refineRequestGen.current,
          snapshotWorkspaceId,
          currentWorkspaceId: workspaceId,
          snapshotBaseProposalDigest,
          currentBaseProposalDigest: proposalDigest,
          responseBaseProposalDigest:
            typeof out.baseProposalDigest === "string"
              ? out.baseProposalDigest
              : undefined,
        })
      ) {
        return;
      }
      if (out.ok === true && out.candidateProposal !== undefined) {
        setCandidateProposal(out.candidateProposal as BuilderProposalLike);
        setCandidateChanges(out.changes as BuilderProposalChangesetV1);
        setCandidateCompileIssues(
          Array.isArray(out.compileIssues) ? out.compileIssues : [],
        );
        setCandidateBaseProposalDigest(snapshotBaseProposalDigest);
      } else {
        setRefineErrorMessage(
          typeof out.message === "string" ? out.message : "Refinement failed.",
        );
      }
      setRefineState("idle");
      setRefineAbortController(undefined);
    } catch (e) {
      if (requestGen !== refineRequestGen.current) {
        return;
      }
      if (e instanceof Error && e.name === "AbortError") {
        setRefineState("idle");
        setRefineAbortController(undefined);
        return;
      }
      setRefineState("error");
      setRefineErrorMessage(
        e instanceof Error ? e.message : "Refinement failed.",
      );
      setRefineAbortController(undefined);
    }
  };

  const handleCancelRefine = () => {
    refineAbortController?.abort();
    refineRequestGen.current += 1;
  };

  const handleAcceptCandidate = () => {
    if (candidateProposal === null || proposal === null) {
      return;
    }
    if (
      !canAcceptRefinementCandidate({
        candidateBaseProposalDigest,
        currentBaseProposalDigest: proposalDigest,
      })
    ) {
      setRefineErrorMessage(
        "Draft changed while reviewing the candidate. Discard and refine again.",
      );
      return;
    }
    if (proposalDigest !== undefined) {
      setAcceptedRevisions((revs) => [
        ...revs,
        {
          proposalDigest,
          proposal,
          refinementInstruction: refinementInstruction.trim(),
          acceptedAt: new Date().toISOString(),
        },
      ]);
    }
    const historyEntry = refinementInstruction.trim();
    if (historyEntry.length > 0) {
      setConversationalHistory((h) => [...h, historyEntry]);
    }
    setProposal(candidateProposal);
    setCompileIssues(candidateCompileIssues);
    setCandidateProposal(null);
    setCandidateChanges(undefined);
    setCandidateCompileIssues([]);
    setCandidateBaseProposalDigest(undefined);
    setRefinementInstruction("");
    setValidation(undefined);
    invalidatePublicationPreflight();
  };

  const handleDiscardCandidate = () => {
    setCandidateProposal(null);
    setCandidateChanges(undefined);
    setCandidateCompileIssues([]);
    setCandidateBaseProposalDigest(undefined);
    setRefineErrorMessage(undefined);
  };

  const handleUndoLastRevision = () => {
    if (acceptedRevisions.length === 0 || publicationLocksDraft) {
      return;
    }
    bumpRefineEpochForDraftMutation();
    const last = acceptedRevisions[acceptedRevisions.length - 1]!;
    setProposal(last.proposal as BuilderProposalLike);
    setAcceptedRevisions((revs) => revs.slice(0, -1));
    setValidation(undefined);
    invalidatePublicationPreflight();
  };

  const handlePreparePublication = async () => {
    if (proposal === null || workspaceId === undefined) {
      return;
    }
    setPublicationPhase("preparing");
    setPublicationPlan(null);
    setPublicationConfirm(false);
    try {
      const plan = await consoleFetch<Record<string, unknown>>(
        "/api/v1/builder/publications/prepare",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proposal }),
        },
      );
      setPublicationPlan(plan);
      setPublicationPhase(plan.publishable === true ? "ready" : "ready");
    } catch {
      setPublicationPhase("idle");
    }
  };

  const handlePublish = async () => {
    if (
      proposal === null ||
      workspaceId === undefined ||
      publicationPlan === null ||
      typeof publicationPlan.planDigest !== "string"
    ) {
      return;
    }
    setPublicationPhase("publishing");
    try {
      const out = await consoleFetch<{
        ok?: boolean;
        replay?: boolean;
        receipt?: Record<string, unknown>;
        status?: string;
        code?: string;
      }>("/api/v1/builder/publications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proposal,
          expectedPlanDigest: publicationPlan.planDigest,
          idempotencyKey: publicationIdempotencyKey,
          acknowledgeUnresolvedRequirements:
            (proposal.unresolvedRequirements ?? []).length > 0,
          confirm: true,
        }),
      });
      if (out.receipt !== undefined) {
        setPublicationReceipt(out.receipt);
        setPublicationPhase("published");
        return;
      }
      setPublicationPhase("unknown");
    } catch (e) {
      if (e instanceof Error && e.message.includes("409")) {
        setPublicationPhase("conflict");
        return;
      }
      setPublicationPhase("unknown");
    }
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
            language, then review and explicitly publish immutable agents and a
            workflow version. Publication never runs the workflow.
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

          {proposal !== null && !publicationLocksDraft ? (
            <section
              className="workflow-nl-builder__subsection"
              aria-label="Conversational refinement"
              data-testid="nl-refinement-panel"
            >
              <h3>Refine draft</h3>
              <p className="text-muted small">
                Describe changes to the current proposal. Review the candidate
                before accepting — your draft is unchanged until you confirm.
              </p>
              <label className="form-label" htmlFor="nl-refine-instruction">
                Refinement instruction
              </label>
              <textarea
                id="nl-refine-instruction"
                className="input workflow-nl-builder__textarea"
                rows={4}
                value={refinementInstruction}
                onChange={(e) => setRefinementInstruction(e.target.value)}
                placeholder="e.g. Add a fact-checking agent before the report step…"
              />
              <div className="workflow-nl-builder__actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={
                    refineState === "loading" ||
                    refinementInstruction.trim().length === 0 ||
                    generationModelProfileVersionId === undefined ||
                    candidateProposal !== null
                  }
                  onClick={() => void handleRefine()}
                >
                  {refineState === "loading" ? "Refining…" : "Refine draft"}
                </button>
                {refineState === "loading" ? (
                  <button
                    type="button"
                    className="button"
                    onClick={handleCancelRefine}
                  >
                    Cancel
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button"
                  disabled={acceptedRevisions.length === 0}
                  onClick={handleUndoLastRevision}
                >
                  Undo last accepted change
                </button>
              </div>
              {refineErrorMessage !== undefined ? (
                <p className="error-text" role="alert">
                  {refineErrorMessage}
                </p>
              ) : null}
              {candidateProposal !== null && candidateChanges !== undefined ? (
                <div
                  className="panel"
                  style={{ marginTop: 12 }}
                  data-testid="nl-candidate-review"
                >
                  <h4>Proposed changes (review)</h4>
                  <ChangesSummary changes={candidateChanges} />
                  <div className="workflow-nl-builder__actions">
                    <button
                      type="button"
                      className="button primary"
                      onClick={handleAcceptCandidate}
                    >
                      Accept changes
                    </button>
                    <button
                      type="button"
                      className="button"
                      onClick={handleDiscardCandidate}
                    >
                      Discard changes
                    </button>
                  </div>
                  {candidateCompileIssues.length > 0 ? (
                    <p className="text-muted small">
                      Candidate has {String(candidateCompileIssues.length)}{" "}
                      compiler note(s) — review before publishing.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {publicationLocksDraft && proposal !== null ? (
            <p className="text-muted small" role="status">
              Refinement and manual edits are disabled while publication is in
              progress, ambiguous, or after a successful publish.
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
            {candidateProposal !== null
              ? " Showing candidate preview — accept or discard to continue editing the base draft."
              : null}
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
                  disabled={publicationLocksDraft}
                  value={proposal.workflowRegistry?.key ?? ""}
                  onChange={(e) => patchRegistryField("key", e.target.value)}
                />
                <label className="form-label" htmlFor="reg-name">
                  Name
                </label>
                <input
                  id="reg-name"
                  className="input"
                  disabled={publicationLocksDraft}
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
                  disabled={publicationLocksDraft}
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

              <PublicationReviewSection
                publicationPhase={publicationPhase}
                publicationPlan={publicationPlan}
                publicationConfirm={publicationConfirm}
                publicationReceipt={publicationReceipt}
                onPrepare={() => void handlePreparePublication()}
                onConfirmChange={setPublicationConfirm}
                onPublish={() => void handlePublish()}
                blockingIssueCount={
                  Array.isArray(publicationPlan?.blockingIssues)
                    ? publicationPlan.blockingIssues.length
                    : Array.isArray(compileIssues)
                      ? compileIssues.length
                      : 0
                }
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function PublicationReviewSection(props: {
  readonly publicationPhase:
    | "idle"
    | "preparing"
    | "ready"
    | "publishing"
    | "published"
    | "conflict"
    | "unknown";
  readonly publicationPlan: Record<string, unknown> | null;
  readonly publicationConfirm: boolean;
  readonly publicationReceipt: Record<string, unknown> | null;
  readonly blockingIssueCount: number;
  readonly onPrepare: () => void;
  readonly onConfirmChange: (checked: boolean) => void;
  readonly onPublish: () => void;
}) {
  const publishable = props.publicationPlan?.publishable === true;
  const canConfirm =
    publishable &&
    props.blockingIssueCount === 0 &&
    props.publicationPhase !== "publishing";

  return (
    <section
      className="workflow-nl-builder__subsection"
      aria-label="Publication review"
      data-testid="nl-publication-review"
    >
      <h3>Publication review (M20.4)</h3>
      <p className="text-muted small">
        Prepare a server-side plan, review immutable changes, then confirm
        publication. The same idempotency key is reused if you retry after a
        timeout.
      </p>
      <div className="workflow-nl-builder__actions">
        <button
          type="button"
          className="button"
          disabled={props.publicationPhase === "preparing"}
          onClick={props.onPrepare}
        >
          {props.publicationPhase === "preparing"
            ? "Preparing review…"
            : "Review publication"}
        </button>
        {props.publicationPhase === "published" &&
        typeof props.publicationReceipt?.workflowId === "string" ? (
          <Link
            className="button primary"
            to={`/workflows/${props.publicationReceipt.workflowId}`}
          >
            Open workflow
          </Link>
        ) : null}
      </div>

      {props.publicationPlan !== null ? (
        <div className="panel" style={{ marginTop: 12 }}>
          <p>
            <strong>Workflow:</strong>{" "}
            {String(
              (props.publicationPlan.workflowRegistry as { name?: string })
                ?.name ?? "",
            )}{" "}
            (
            <code>
              {String(
                (props.publicationPlan.workflowRegistry as { key?: string })
                  ?.key ?? "",
              )}
            </code>
            )
          </p>
          <p>
            <strong>Plan digest:</strong>{" "}
            <code className="small">
              {String(props.publicationPlan.planDigest ?? "").slice(0, 48)}…
            </code>
          </p>
          {!publishable ? (
            <p className="error-text" role="alert">
              This proposal is not publishable. Fix blocking issues and prepare
              again.
            </p>
          ) : null}
          <label className="form-label">
            <input
              type="checkbox"
              checked={props.publicationConfirm}
              disabled={!canConfirm}
              onChange={(e) => props.onConfirmChange(e.target.checked)}
            />{" "}
            I understand these agents and workflow version will be immutable.
          </label>
          <button
            type="button"
            className="button primary"
            disabled={!canConfirm || !props.publicationConfirm}
            onClick={props.onPublish}
          >
            {props.publicationPhase === "publishing"
              ? "Publishing…"
              : "Publish workflow & agents"}
          </button>
        </div>
      ) : null}

      {props.publicationPhase === "conflict" ? (
        <p className="error-text" role="alert">
          Plan conflict or stale digest — edit the draft and run{" "}
          <strong>Review publication</strong> again.
        </p>
      ) : null}
      {props.publicationPhase === "unknown" ? (
        <p className="text-muted" role="status">
          Publication result unknown. Retry publish with the same draft (same
          idempotency key) or fetch the receipt by publication ID when
          supported.
        </p>
      ) : null}
      {props.publicationReceipt !== null ? (
        <p className="text-muted small">
          Published workflow version{" "}
          <code>
            {String(props.publicationReceipt.workflowVersionId ?? "")}
          </code>
        </p>
      ) : null}
    </section>
  );
}

function ChangesSummary(props: {
  readonly changes: BuilderProposalChangesetV1;
}) {
  const c = props.changes;
  if (c.noop) {
    return <p className="text-muted">No structural changes detected.</p>;
  }
  return (
    <ul className="workflow-nl-builder__change-summary">
      {c.addedAgents.length > 0 ? (
        <li>
          Added agents:{" "}
          {c.addedAgents.map((a: { ref: string }) => (
            <code key={a.ref}>{a.ref}</code>
          ))}
        </li>
      ) : null}
      {c.removedAgents.length > 0 ? (
        <li>
          Removed agents:{" "}
          {c.removedAgents.map((a: { ref: string }) => (
            <code key={a.ref}>{a.ref}</code>
          ))}
        </li>
      ) : null}
      {c.modifiedAgents.length > 0 ? (
        <li>
          Modified agents:{" "}
          {c.modifiedAgents.map(
            (a: { ref: string; fields: readonly string[] }) => (
              <span key={a.ref}>
                <code>{a.ref}</code> ({a.fields.join(", ")}){" "}
              </span>
            ),
          )}
        </li>
      ) : null}
      {c.graphNodeChanges.length > 0 ? (
        <li>{String(c.graphNodeChanges.length)} graph node change(s)</li>
      ) : null}
      {c.graphEdgeChanges.length > 0 ? (
        <li>{String(c.graphEdgeChanges.length)} graph edge change(s)</li>
      ) : null}
      {c.registryChanges.length > 0 ? <li>Registry field updates</li> : null}
    </ul>
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
