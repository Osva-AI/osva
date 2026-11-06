import type {
  AgentVersionId,
  ModelProfileVersionId,
  ToolVersionId,
} from "@osva-ai/contracts";

import type { BuilderProposalAgentRef } from "./builder-proposal.js";

export type BuilderIssueSeverity = "error" | "warning";

/**
 * Stable diagnostic codes for builder compilation (M20.1 internal).
 * Prefer matching {@link BuilderIssueCode} values across releases.
 */
export type BuilderIssueCode =
  | "INVALID_PROPOSAL_SCHEMA"
  | "INVALID_GRAPH_TOPOLOGY"
  | "UNKNOWN_AGENT_REFERENCE"
  | "MISSING_MODEL_SELECTION"
  | "MISSING_TOOL_SELECTION"
  | "UNAUTHORIZED_OR_FOREIGN_RESOURCE"
  | "UNSUPPORTED_NODE_CONFIGURATION"
  | "MISSING_AGENT_VERSION_RESOLUTION"
  | "INVALID_COMPILED_AGENT_MANIFEST"
  | "INVALID_COMPILED_WORKFLOW_DEFINITION"
  | "DUPLICATE_AGENT_REFERENCE"
  | "DUPLICATE_NODE_KEY";

export type BuilderIssueLocation =
  | {
      readonly kind: "agent_spec";
      readonly ref?: BuilderProposalAgentRef;
    }
  | {
      readonly kind: "workflow_node";
      readonly nodeKey: string;
    }
  | {
      readonly kind: "workflow_edge";
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly kind: "resource";
      readonly resource:
        | {
            readonly kind: "modelProfileVersion";
            readonly id: ModelProfileVersionId;
          }
        | { readonly kind: "toolVersion"; readonly id: ToolVersionId }
        | { readonly kind: "agentVersion"; readonly id: AgentVersionId };
    }
  | { readonly kind: "proposal_root" };

export interface BuilderIssueV1 {
  readonly code: BuilderIssueCode;
  readonly severity: BuilderIssueSeverity;
  readonly message: string;
  readonly action?: string;
  readonly location?: BuilderIssueLocation;
}

export function builderIssue(
  partial: Omit<BuilderIssueV1, "severity"> & {
    readonly severity?: BuilderIssueSeverity;
  },
): BuilderIssueV1 {
  return {
    severity: "error",
    ...partial,
  };
}

export function sortIssuesDeterministic(
  issues: readonly BuilderIssueV1[],
): BuilderIssueV1[] {
  return [...issues].sort((a, b) => {
    const byCode = a.code.localeCompare(b.code);
    if (byCode !== 0) {
      return byCode;
    }

    const sevOrder = (s: BuilderIssueSeverity) => (s === "error" ? 0 : 1);
    const bySev = sevOrder(a.severity) - sevOrder(b.severity);
    if (bySev !== 0) {
      return bySev;
    }

    const locA = a.location?.kind ?? "";
    const locB = b.location?.kind ?? "";
    const byLocKind = locA.localeCompare(locB);
    if (byLocKind !== 0) {
      return byLocKind;
    }

    if (
      a.location?.kind === "workflow_node" &&
      b.location?.kind === "workflow_node"
    ) {
      return a.location.nodeKey.localeCompare(b.location.nodeKey);
    }

    if (
      a.location?.kind === "workflow_edge" &&
      b.location?.kind === "workflow_edge"
    ) {
      const byFrom = a.location.from.localeCompare(b.location.from);
      if (byFrom !== 0) {
        return byFrom;
      }

      return a.location.to.localeCompare(b.location.to);
    }

    if (
      a.location?.kind === "agent_spec" &&
      b.location?.kind === "agent_spec"
    ) {
      return (a.location.ref ?? "").localeCompare(b.location.ref ?? "");
    }

    if (a.location?.kind === "resource" && b.location?.kind === "resource") {
      const k = a.location.resource.kind.localeCompare(
        b.location.resource.kind,
      );
      if (k !== 0) {
        return k;
      }

      return String(a.location.resource.id).localeCompare(
        String(b.location.resource.id),
      );
    }

    return a.message.localeCompare(b.message);
  });
}
