import type { WorkspaceId } from "@osva-ai/contracts";

import type { AgentRepository } from "../ports/agent-repository.js";
import type { WorkflowRepository } from "../ports/workflow-repository.js";
import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "../control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "../control-plane-resource-kinds.js";
import { AUTHORIZATION_ACTIONS } from "@osva-ai/contracts";

import type { BuilderCatalogIndexV1 } from "./builder-compiler.js";
import {
  buildBuilderCatalogIndex,
  compileBuilderProposalPrePublication,
} from "./builder-compiler.js";
import { builderIssue, sortIssuesDeterministic } from "./builder-issue.js";
import type { BuilderIssueV1 } from "./builder-issue.js";
import {
  computeBuilderPublicationPlanDigest,
  defaultBuilderPublicationMode,
} from "./builder-publication-plan-digest.js";
import type { BuilderPublicationPlanV1 } from "./builder-publication-types.js";
import type { BuilderProposalV1 } from "./builder-proposal.js";
import type { WorkspaceBuilderCapabilityCatalogV1 } from "./workspace-builder-capability-catalog.js";

const AGENT_RESOURCE = { kind: CONTROL_PLANE_RESOURCE_KINDS.agent };
const WORKFLOW_RESOURCE = { kind: CONTROL_PLANE_RESOURCE_KINDS.workflow };

export interface BuildBuilderPublicationPlanInput {
  readonly scope: ControlPlaneScope;
  readonly proposalUnknown: unknown;
  readonly catalog: WorkspaceBuilderCapabilityCatalogV1;
  readonly agents: AgentRepository;
  readonly workflows: WorkflowRepository;
}

export async function buildBuilderPublicationPlan(
  input: BuildBuilderPublicationPlanInput,
): Promise<BuilderPublicationPlanV1> {
  requireControlPlaneAuthorization(
    input.scope,
    AUTHORIZATION_ACTIONS.WRITE,
    AGENT_RESOURCE,
  );
  requireControlPlaneAuthorization(
    input.scope,
    AUTHORIZATION_ACTIONS.WRITE,
    WORKFLOW_RESOURCE,
  );

  const workspaceId = controlPlaneWorkspaceId(input.scope);
  const index: BuilderCatalogIndexV1 = buildBuilderCatalogIndex(input.catalog);
  const compiled = compileBuilderProposalPrePublication(
    input.proposalUnknown,
    index,
  );

  const registryIssues: BuilderIssueV1[] = [];
  let proposal = compiled.proposal;

  if (proposal === undefined) {
    const planDigest = computeBuilderPublicationPlanDigest({
      workspaceId,
      publicationMode: defaultBuilderPublicationMode(),
      proposal: emptyProposalShell(),
    });
    return {
      planDigest,
      publicationMode: defaultBuilderPublicationMode(),
      workspaceId,
      workflowRegistry: { key: "", name: "" },
      newAgents: [],
      reusedAgents: [],
      previewLogicalWorkflowDigest: undefined,
      assumptions: [],
      unresolvedRequirements: [],
      blockingIssues: sortIssuesDeterministic(compiled.issues),
      warnings: [],
      publishable: false,
      requiresUnresolvedAcknowledgement: false,
    };
  }

  const existingAgents =
    await input.agents.listAgentsByWorkspaceId(workspaceId);
  const existingAgentKeys = new Set(existingAgents.map((a) => a.key));
  const existingWorkflows =
    await input.workflows.listWorkflowsByWorkspaceId(workspaceId);
  const existingWorkflowKeys = new Set(existingWorkflows.map((w) => w.key));

  for (const spec of proposal.agents) {
    if (spec.kind !== "NEW") {
      continue;
    }
    if (existingAgentKeys.has(spec.agentKey)) {
      registryIssues.push(
        builderIssue({
          code: "DUPLICATE_AGENT_REFERENCE",
          message: `Agent registry key '${spec.agentKey}' already exists in this workspace.`,
          action: "Choose a unique agent key or reference an EXISTING agent.",
          location: { kind: "agent_spec", ref: spec.ref },
        }),
      );
    }
  }

  if (existingWorkflowKeys.has(proposal.workflowRegistry.key)) {
    registryIssues.push(
      builderIssue({
        code: "INVALID_PROPOSAL_SCHEMA",
        message: `Workflow registry key '${proposal.workflowRegistry.key}' already exists in this workspace.`,
        action: "Choose a unique workflow key for a new workflow.",
        location: { kind: "proposal_root" },
      }),
    );
  }

  const unresolvedRequirements = [...proposal.unresolvedRequirements];
  const requiresUnresolvedAcknowledgement = unresolvedRequirements.length > 0;

  const newAgents = proposal.agents
    .filter((s): s is Extract<typeof s, { kind: "NEW" }> => s.kind === "NEW")
    .map((s) => ({
      ref: s.ref,
      agentKey: s.agentKey,
      agentName: s.agentName,
    }))
    .sort((a, b) => a.ref.localeCompare(b.ref));

  const reusedAgents = proposal.agents
    .filter(
      (s): s is Extract<typeof s, { kind: "EXISTING" }> =>
        s.kind === "EXISTING",
    )
    .map((s) => {
      const entry = index.agentVersionsById.get(s.agentVersionId);
      return {
        ref: s.ref,
        agentVersionId: s.agentVersionId,
        agentKey: entry?.agentKey ?? "(unknown)",
        agentName: entry?.agentName ?? "(unknown)",
      };
    })
    .sort((a, b) => a.ref.localeCompare(b.ref));

  const blockingIssues = sortIssuesDeterministic([
    ...compiled.issues,
    ...registryIssues,
  ]);

  const planDigest = computeBuilderPublicationPlanDigest({
    workspaceId,
    publicationMode: defaultBuilderPublicationMode(),
    proposal,
  });

  const publishable =
    compiled.ok &&
    registryIssues.length === 0 &&
    blockingIssues.every((i) => i.severity !== "error");

  return {
    planDigest,
    publicationMode: defaultBuilderPublicationMode(),
    workspaceId,
    workflowRegistry: proposal.workflowRegistry,
    newAgents,
    reusedAgents,
    previewLogicalWorkflowDigest: compiled.previewLogicalWorkflowDigest,
    assumptions: [...proposal.assumptions],
    unresolvedRequirements,
    blockingIssues,
    warnings: [],
    publishable,
    requiresUnresolvedAcknowledgement,
  };
}

function emptyProposalShell(): BuilderProposalV1 {
  return {
    schemaVersion: "1",
    workflowRegistry: { key: "", name: "" },
    agents: [],
    workflow: { nodes: [], edges: [] },
    assumptions: [],
    unresolvedRequirements: [],
  };
}
