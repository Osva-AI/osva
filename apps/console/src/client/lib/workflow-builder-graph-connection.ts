import type { WorkflowBuilderDraft } from "./workflow-builder-draft";
import {
  connectWorkflowNodes,
  disconnectWorkflowEdge,
} from "./workflow-builder-graph";

export interface WorkflowGraphConnectionAttempt {
  readonly ok: boolean;
  readonly message: string;
  readonly draft: WorkflowBuilderDraft;
}

export function tryConnectWorkflowNodes(
  draft: WorkflowBuilderDraft,
  from: string,
  to: string,
): WorkflowGraphConnectionAttempt {
  if (from.length === 0 || to.length === 0) {
    return {
      ok: false,
      message: "Choose both a source step and a destination step.",
      draft,
    };
  }
  if (from === to) {
    return {
      ok: false,
      message: "A step cannot connect to itself.",
      draft,
    };
  }
  const nodeKeys = new Set(draft.definition.nodes.map((node) => node.key));
  if (!nodeKeys.has(from)) {
    return {
      ok: false,
      message: `Source step "${from}" is not in this draft.`,
      draft,
    };
  }
  if (!nodeKeys.has(to)) {
    return {
      ok: false,
      message: `Destination step "${to}" is not in this draft.`,
      draft,
    };
  }
  const already = draft.definition.edges.some(
    (edge) => edge.from === from && edge.to === to,
  );
  if (already) {
    return {
      ok: false,
      message: "These steps are already connected.",
      draft,
    };
  }
  const next = connectWorkflowNodes(draft, from, to);
  if (next.definition.edges.length === draft.definition.edges.length) {
    return {
      ok: false,
      message: "This connection could not be added.",
      draft,
    };
  }
  return {
    ok: true,
    message: `Connected ${from} → ${to}.`,
    draft: next,
  };
}

export function tryDisconnectWorkflowEdge(
  draft: WorkflowBuilderDraft,
  from: string,
  to: string,
): WorkflowGraphConnectionAttempt {
  const exists = draft.definition.edges.some(
    (edge) => edge.from === from && edge.to === to,
  );
  if (!exists) {
    return {
      ok: false,
      message: "That connection is not in the draft.",
      draft,
    };
  }
  return {
    ok: true,
    message: `Removed connection ${from} → ${to}.`,
    draft: disconnectWorkflowEdge(draft, from, to),
  };
}
