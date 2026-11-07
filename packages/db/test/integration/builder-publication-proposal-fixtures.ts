import type {
  ApiKeyId,
  CommunityEditionRole,
  ModelProfileVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  AUTHENTICATION_METHODS,
  COMMUNITY_EDITION_ROLES,
} from "@osva-ai/contracts";

import type {
  BuilderProposalNewAgentV1,
  BuilderProposalV1,
} from "@osva/domain/builder";
import type { ControlPlaneScope } from "@osva/domain";

export function minimalNewAgent(
  ref: `bpr_${string}`,
): BuilderProposalNewAgentV1 {
  return {
    kind: "NEW",
    ref,
    agentKey: `key-${ref}`,
    agentName: `Name ${ref}`,
    instructions: "Do the task.",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    modelBindingName: "default",
    model: {
      bindingName: "default",
      modelProfileVersionId: "mpv-test" as ModelProfileVersionId,
    },
    tools: [],
    execution: {
      timeoutMs: 30_000,
      maxAttempts: 2,
      maxModelInvocations: 4,
      maxToolInvocations: 0,
    },
  };
}

export function baseProposal(
  overrides: Partial<BuilderProposalV1> = {},
): BuilderProposalV1 {
  const agent = minimalNewAgent("bpr_a");
  return {
    schemaVersion: "1",
    workflowRegistry: { key: "wf", name: "WF" },
    agents: [agent],
    workflow: {
      nodes: [{ key: "n1", type: "AGENT", agentRef: "bpr_a" }],
      edges: [],
    },
    assumptions: [],
    unresolvedRequirements: [],
    ...overrides,
  };
}

export function publicationProposalFor(
  workspaceKey: string,
  mpvId: ModelProfileVersionId,
  workflowRegistry?: { key: string; name: string },
): BuilderProposalV1 {
  return baseProposal({
    workflowRegistry: workflowRegistry ?? {
      key: `${workspaceKey}-wf`,
      name: "WF",
    },
    agents: [
      {
        ...minimalNewAgent("bpr_a"),
        agentKey: `${workspaceKey}-agent`,
        model: { bindingName: "default", modelProfileVersionId: mpvId },
      },
    ],
  });
}

export function fakeControlPlaneScope(
  workspaceId: WorkspaceId,
  role: CommunityEditionRole = COMMUNITY_EDITION_ROLES.ADMIN,
): ControlPlaneScope {
  return {
    principal: {
      subjectId: "test-api-key" as ApiKeyId,
      workspaceId,
      role,
      authenticationMethod: AUTHENTICATION_METHODS.API_KEY,
    },
  };
}
