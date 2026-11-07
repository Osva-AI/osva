import type { JsonValue, WorkspaceId } from "@osva-ai/contracts";

import { canonicalJsonStringify } from "../json-equality.js";

import {
  BUILDER_PUBLICATION_MODE_CREATE_V1,
  type BuilderPublicationModeV1,
} from "./builder-publication-types.js";
import type { BuilderProposalV1 } from "./builder-proposal.js";
import { sortedWorkflowNodesForDeterminism } from "./builder-compiler.js";

export const BUILDER_PUBLICATION_PLAN_DIGEST_VERSION = "1" as const;

export function canonicalizeProposalForPublicationDigest(
  proposal: BuilderProposalV1,
): JsonValue {
  const agents = [...proposal.agents]
    .map((spec) => {
      if (spec.kind === "NEW") {
        return {
          kind: "NEW" as const,
          ref: spec.ref,
          agentKey: spec.agentKey,
          agentName: spec.agentName,
          instructions: spec.instructions,
          inputSchema: spec.inputSchema,
          outputSchema: spec.outputSchema,
          modelBindingName: spec.modelBindingName,
          model: spec.model,
          tools: [...spec.tools].sort((a, b) =>
            a.bindingName.localeCompare(b.bindingName),
          ),
          execution: spec.execution,
        };
      }

      return {
        kind: "EXISTING" as const,
        ref: spec.ref,
        agentVersionId: spec.agentVersionId,
      };
    })
    .sort((a, b) => a.ref.localeCompare(b.ref));

  const edges = [...proposal.workflow.edges].sort((a, b) => {
    const fromCmp = a.from.localeCompare(b.from);
    if (fromCmp !== 0) {
      return fromCmp;
    }
    return a.to.localeCompare(b.to);
  });

  return {
    schemaVersion: proposal.schemaVersion,
    workflowRegistry: proposal.workflowRegistry,
    agents,
    workflow: {
      nodes: sortedWorkflowNodesForDeterminism(proposal.workflow.nodes),
      edges,
    },
    assumptions: [...proposal.assumptions].sort((a, b) => a.localeCompare(b)),
    unresolvedRequirements: [...proposal.unresolvedRequirements].sort((a, b) =>
      a.localeCompare(b),
    ),
  } as unknown as JsonValue;
}

export function computeBuilderPublicationPlanDigest(input: {
  readonly workspaceId: WorkspaceId;
  readonly publicationMode: BuilderPublicationModeV1;
  readonly proposal: BuilderProposalV1;
}): string {
  const payload = {
    planDigestVersion: BUILDER_PUBLICATION_PLAN_DIGEST_VERSION,
    publicationMode: input.publicationMode,
    workspaceId: input.workspaceId,
    proposal: canonicalizeProposalForPublicationDigest(input.proposal),
  };

  return canonicalJsonStringify(payload as JsonValue);
}

export function defaultBuilderPublicationMode(): BuilderPublicationModeV1 {
  return BUILDER_PUBLICATION_MODE_CREATE_V1;
}
