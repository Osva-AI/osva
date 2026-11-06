import type {
  AgentManifestV1,
  AgentVersionId,
  JsonValue,
  ModelProfileVersionId,
  ToolVersionId,
  WorkflowDefinitionEdgeV3,
  WorkflowDefinitionNodeV3,
  WorkflowDefinitionV3,
} from "@osva-ai/contracts";
import { validateAgentManifest } from "@osva-ai/contracts";

import { canonicalJsonStringify } from "../json-equality.js";
import {
  assertDagWorkflowV3GraphTopology,
  assertWorkflowDefinition,
  type WorkflowDefinitionV3NodeForTopology,
} from "../workflow-definition.js";
import { InvalidWorkflowDefinitionError } from "../errors.js";

import type { BuilderIssueV1 } from "./builder-issue.js";
import { builderIssue, sortIssuesDeterministic } from "./builder-issue.js";
import type {
  BuilderProposalAgentRef,
  BuilderProposalAgentSpecV1,
  BuilderProposalNewAgentV1,
  BuilderProposalV1,
  BuilderProposalWorkflowNodeIntentV1,
} from "./builder-proposal.js";
import { parseBuilderProposalV1 } from "./builder-proposal-schema.js";
import type {
  WorkspaceBuilderAgentVersionCatalogEntryV1,
  WorkspaceBuilderCapabilityCatalogV1,
  WorkspaceBuilderModelProfileVersionCatalogEntryV1,
  WorkspaceBuilderToolVersionCatalogEntryV1,
} from "./workspace-builder-capability-catalog.js";

export interface BuilderCatalogIndexV1 {
  readonly agentVersionsById: ReadonlyMap<
    AgentVersionId,
    WorkspaceBuilderAgentVersionCatalogEntryV1
  >;
  readonly modelProfileVersionsById: ReadonlyMap<
    ModelProfileVersionId,
    WorkspaceBuilderModelProfileVersionCatalogEntryV1
  >;
  readonly toolVersionsById: ReadonlyMap<
    ToolVersionId,
    WorkspaceBuilderToolVersionCatalogEntryV1
  >;
}

export function buildBuilderCatalogIndex(
  catalog: WorkspaceBuilderCapabilityCatalogV1,
): BuilderCatalogIndexV1 {
  const agentVersionsById = new Map<
    AgentVersionId,
    WorkspaceBuilderAgentVersionCatalogEntryV1
  >();
  for (const entry of catalog.agentVersions) {
    agentVersionsById.set(entry.agentVersionId, entry);
  }

  const modelProfileVersionsById = new Map<
    ModelProfileVersionId,
    WorkspaceBuilderModelProfileVersionCatalogEntryV1
  >();
  for (const entry of catalog.modelProfileVersions) {
    modelProfileVersionsById.set(entry.modelProfileVersionId, entry);
  }

  const toolVersionsById = new Map<
    ToolVersionId,
    WorkspaceBuilderToolVersionCatalogEntryV1
  >();
  for (const entry of catalog.toolVersions) {
    toolVersionsById.set(entry.toolVersionId, entry);
  }

  return { agentVersionsById, modelProfileVersionsById, toolVersionsById };
}

function workflowIntentToLogicalTopology(proposal: BuilderProposalV1): {
  readonly nodes: readonly WorkflowDefinitionV3NodeForTopology[];
  readonly edges: readonly WorkflowDefinitionEdgeV3[];
} {
  const nodes: WorkflowDefinitionV3NodeForTopology[] =
    proposal.workflow.nodes.map((node) => {
      if (node.type === "AGENT") {
        return { key: node.key, type: "AGENT" };
      }

      return node;
    });

  const edges = [...proposal.workflow.edges].sort((a, b) => {
    const fromCmp = a.from.localeCompare(b.from);
    if (fromCmp !== 0) {
      return fromCmp;
    }

    return a.to.localeCompare(b.to);
  });

  return { nodes, edges };
}

function workflowIntentToWorkflowDefinitionV3(
  proposal: BuilderProposalV1,
  agentRefToVersionId: ReadonlyMap<BuilderProposalAgentRef, AgentVersionId>,
): WorkflowDefinitionV3 {
  const nodes: WorkflowDefinitionNodeV3[] = proposal.workflow.nodes.map(
    (node) => {
      if (node.type === "AGENT") {
        const bound = agentRefToVersionId.get(node.agentRef);
        if (bound === undefined) {
          throw new Error(
            `Internal builder error: missing agent version binding for ref ${node.agentRef}.`,
          );
        }

        return {
          key: node.key,
          type: "AGENT",
          agentVersionId: bound,
        };
      }

      return node as WorkflowDefinitionNodeV3;
    },
  );

  const edges = [...proposal.workflow.edges].sort((a, b) => {
    const fromCmp = a.from.localeCompare(b.from);
    if (fromCmp !== 0) {
      return fromCmp;
    }

    return a.to.localeCompare(b.to);
  });

  return {
    schemaVersion: "3",
    nodes,
    edges,
  };
}

export function compileDeclarativeManifestFromNewAgent(
  spec: BuilderProposalNewAgentV1,
): AgentManifestV1 {
  const models: AgentManifestV1["models"] = {
    [spec.modelBindingName]: {
      modelProfileVersionId: spec.model.modelProfileVersionId,
    },
  };

  const tools: Record<string, { toolVersionId: ToolVersionId }> = {};
  const allowedToolBindingNames: string[] = [];
  for (const selection of spec.tools) {
    tools[selection.bindingName] = {
      toolVersionId: selection.toolVersionId,
    };
    allowedToolBindingNames.push(selection.bindingName);
  }

  allowedToolBindingNames.sort((a, b) => a.localeCompare(b));

  return {
    schemaVersion: "1",
    key: spec.agentKey,
    name: spec.agentName,
    runtime: {
      type: "DECLARATIVE",
      config: {
        configVersion: "1",
        instructions: spec.instructions,
        modelBinding: spec.modelBindingName,
        allowedToolBindings: allowedToolBindingNames,
        maxModelInvocations: spec.execution.maxModelInvocations,
        maxToolInvocations: spec.execution.maxToolInvocations,
        maxOutputTokens: spec.execution.maxOutputTokens,
        checkpointingEnabled: spec.execution.checkpointingEnabled,
        automaticRecoveryEnabled: spec.execution.automaticRecoveryEnabled,
      },
    },
    input: { schema: spec.inputSchema },
    output: { schema: spec.outputSchema },
    execution: {
      timeoutMs: spec.execution.timeoutMs,
      maxAttempts: spec.execution.maxAttempts,
    },
    capabilities: {
      model: true,
      tools: allowedToolBindingNames,
    },
    models,
    tools: tools as NonNullable<AgentManifestV1["tools"]>,
  };
}

function collectResourceIssues(
  proposal: BuilderProposalV1,
  catalog: BuilderCatalogIndexV1,
): BuilderIssueV1[] {
  const issues: BuilderIssueV1[] = [];

  for (const spec of proposal.agents) {
    if (spec.kind === "EXISTING") {
      const entry = catalog.agentVersionsById.get(spec.agentVersionId);
      if (entry === undefined) {
        issues.push(
          builderIssue({
            code: "UNAUTHORIZED_OR_FOREIGN_RESOURCE",
            severity: "error",
            message: `AgentVersion '${spec.agentVersionId}' is not available in this workspace catalog.`,
            action:
              "Choose a published AgentVersion from the workspace capability catalog.",
            location: {
              kind: "resource",
              resource: { kind: "agentVersion", id: spec.agentVersionId },
            },
          }),
        );
      }
      continue;
    }

    const modelId = spec.model.modelProfileVersionId;
    if (!catalog.modelProfileVersionsById.has(modelId)) {
      issues.push(
        builderIssue({
          code: "MISSING_MODEL_SELECTION",
          message: `Model profile version '${modelId}' is not in the workspace catalog.`,
          action: "Bind the proposed agent to a catalog ModelProfileVersion.",
          location: {
            kind: "resource",
            resource: { kind: "modelProfileVersion", id: modelId },
          },
        }),
      );
    }

    const seenBindings = new Set<string>();
    for (const toolSel of spec.tools) {
      if (seenBindings.has(toolSel.bindingName)) {
        issues.push(
          builderIssue({
            code: "UNSUPPORTED_NODE_CONFIGURATION",
            message: `Duplicate tool binding name '${toolSel.bindingName}' on new agent ${spec.ref}.`,
            action: "Use distinct tool binding names for each tool.",
            location: { kind: "agent_spec", ref: spec.ref },
          }),
        );
      }
      seenBindings.add(toolSel.bindingName);

      if (!catalog.toolVersionsById.has(toolSel.toolVersionId)) {
        issues.push(
          builderIssue({
            code: "MISSING_TOOL_SELECTION",
            message: `Tool version '${toolSel.toolVersionId}' is not in the workspace catalog.`,
            action: "Bind each tool to a catalog ToolVersion.",
            location: {
              kind: "resource",
              resource: { kind: "toolVersion", id: toolSel.toolVersionId },
            },
          }),
        );
      }
    }
  }

  return issues;
}

function agentRefsUsedInWorkflow(
  proposal: BuilderProposalV1,
): ReadonlySet<BuilderProposalAgentRef> {
  const refs = new Set<BuilderProposalAgentRef>();
  for (const node of proposal.workflow.nodes) {
    if (node.type === "AGENT") {
      refs.add(node.agentRef);
    }
  }

  return refs;
}

function refToSpec(
  proposal: BuilderProposalV1,
): ReadonlyMap<BuilderProposalAgentRef, BuilderProposalAgentSpecV1> {
  const map = new Map<BuilderProposalAgentRef, BuilderProposalAgentSpecV1>();
  for (const spec of proposal.agents) {
    map.set(spec.ref, spec);
  }

  return map;
}

function collectAgentRefIssues(proposal: BuilderProposalV1): BuilderIssueV1[] {
  const issues: BuilderIssueV1[] = [];
  const specByRef = refToSpec(proposal);
  const used = agentRefsUsedInWorkflow(proposal);

  const seenSpecRefs = new Set<BuilderProposalAgentRef>();
  for (const spec of proposal.agents) {
    if (seenSpecRefs.has(spec.ref)) {
      issues.push(
        builderIssue({
          code: "DUPLICATE_AGENT_REFERENCE",
          message: `Duplicate agent ref '${spec.ref}' in proposal.agents.`,
          action: "Ensure each temporary agent ref appears at most once.",
          location: { kind: "agent_spec", ref: spec.ref },
        }),
      );
    }
    seenSpecRefs.add(spec.ref);
  }

  const unknown = [...used]
    .filter((ref) => !specByRef.has(ref))
    .sort((a, b) => a.localeCompare(b));
  if (unknown.length > 0) {
    issues.push(
      builderIssue({
        code: "UNKNOWN_AGENT_REFERENCE",
        message: `Workflow references unknown agent ref(s): ${unknown.join(", ")}.`,
        action:
          "Declare each ref under proposal.agents or fix workflow AGENT nodes.",
        location: { kind: "proposal_root" },
      }),
    );
  }

  return issues;
}

function tryAssertWorkflow(definition: WorkflowDefinitionV3): BuilderIssueV1[] {
  try {
    assertWorkflowDefinition(definition);
    return [];
  } catch (error) {
    if (error instanceof InvalidWorkflowDefinitionError) {
      return [
        builderIssue({
          code: "INVALID_GRAPH_TOPOLOGY",
          message: error.message,
          action:
            "Repair workflow edges and node roles to form a valid single-entry DAG.",
        }),
      ];
    }

    throw error;
  }
}

function tryAssertLogicalWorkflowTopology(
  proposal: BuilderProposalV1,
): BuilderIssueV1[] {
  try {
    const { nodes, edges } = workflowIntentToLogicalTopology(proposal);
    assertDagWorkflowV3GraphTopology({ nodes, edges });
    return [];
  } catch (error) {
    if (error instanceof InvalidWorkflowDefinitionError) {
      return [
        builderIssue({
          code: "INVALID_GRAPH_TOPOLOGY",
          message: error.message,
          action:
            "Repair workflow edges and node roles to form a valid single-entry DAG.",
        }),
      ];
    }

    throw error;
  }
}

function parseAndSchemaIssues(unknown: unknown): {
  proposal?: BuilderProposalV1;
  issues: BuilderIssueV1[];
} {
  const parsed = parseBuilderProposalV1(unknown);
  if (parsed.ok) {
    return { proposal: parsed.proposal, issues: [] };
  }

  return {
    issues: [...parsed.messages]
      .sort((a, b) => a.localeCompare(b))
      .map((message) =>
        builderIssue({
          code: "INVALID_PROPOSAL_SCHEMA",
          message,
          action:
            "Fix the BuilderProposalV1 payload to satisfy internal schema bounds.",
          location: { kind: "proposal_root" },
        }),
      ),
  };
}

export interface BuilderPrePublicationCompileResultV1 {
  readonly ok: boolean;
  readonly issues: readonly BuilderIssueV1[];
  readonly proposal?: BuilderProposalV1;
  readonly compiledNewAgentManifests?: ReadonlyMap<
    BuilderProposalAgentRef,
    AgentManifestV1
  >;
  /**
   * Canonical digest of the logical V3 topology (AGENT nodes without AgentVersionId bindings).
   * Not a persisted WorkflowDefinitionV3.
   */
  readonly previewLogicalWorkflowDigest?: string;
}

/**
 * Phase 1 — pre-publication: validate proposal, resolve catalog bindings for NEW agents, compile manifests,
 * and validate logical workflow topology using temporary agent references (no AgentVersionId placeholders).
 */
export function compileBuilderProposalPrePublication(
  unknownProposal: unknown,
  catalog: BuilderCatalogIndexV1,
): BuilderPrePublicationCompileResultV1 {
  const { proposal, issues: parseIssues } =
    parseAndSchemaIssues(unknownProposal);
  if (proposal === undefined) {
    return { ok: false, issues: sortIssuesDeterministic(parseIssues) };
  }

  const refIssues = collectAgentRefIssues(proposal);
  const resourceIssues = collectResourceIssues(proposal, catalog);
  const manifestIssues: BuilderIssueV1[] = [];
  const compiled = new Map<BuilderProposalAgentRef, AgentManifestV1>();

  for (const spec of proposal.agents) {
    if (spec.kind === "NEW") {
      const manifest = compileDeclarativeManifestFromNewAgent(spec);
      const validation = validateAgentManifest(manifest);
      if (!validation.ok) {
        for (const message of validation.messages) {
          manifestIssues.push(
            builderIssue({
              code: "INVALID_COMPILED_AGENT_MANIFEST",
              message: `${spec.ref}: ${message}`,
              action:
                "Adjust the NEW agent fields to satisfy declarative manifest rules.",
              location: { kind: "agent_spec", ref: spec.ref },
            }),
          );
        }
      } else {
        compiled.set(spec.ref, validation.manifest);
      }
    }
  }

  const blocking = [
    ...parseIssues,
    ...refIssues,
    ...resourceIssues,
    ...manifestIssues,
  ];
  if (blocking.length > 0) {
    return {
      ok: false,
      issues: sortIssuesDeterministic(blocking),
      proposal,
      compiledNewAgentManifests: compiled,
    };
  }

  const topoIssues = tryAssertLogicalWorkflowTopology(proposal);
  if (topoIssues.length > 0) {
    return {
      ok: false,
      issues: sortIssuesDeterministic(topoIssues),
      proposal,
      compiledNewAgentManifests: compiled,
    };
  }

  const logical = workflowIntentToLogicalTopology(proposal);
  const digestPayload = {
    nodes: [...logical.nodes].sort((a, b) => a.key.localeCompare(b.key)),
    edges: logical.edges,
  };

  return {
    ok: true,
    issues: [],
    proposal,
    compiledNewAgentManifests: compiled,
    previewLogicalWorkflowDigest: canonicalJsonStringify(
      digestPayload as unknown as JsonValue,
    ),
  };
}

export interface BuilderResolvedCompileResultV1 {
  readonly ok: boolean;
  readonly issues: readonly BuilderIssueV1[];
  readonly workflowDefinition?: WorkflowDefinitionV3;
  readonly workflowDefinitionDigest?: string;
}

/**
 * Phase 2 — resolved compilation: map every workflow AGENT ref to an authorized immutable AgentVersionId,
 * then produce canonical WorkflowDefinitionV3 validated by domain `assertWorkflowDefinition`.
 */
export function compileBuilderProposalResolved(
  proposal: BuilderProposalV1,
  catalog: BuilderCatalogIndexV1,
  resolution: ReadonlyMap<BuilderProposalAgentRef, AgentVersionId>,
): BuilderResolvedCompileResultV1 {
  const specByRef = refToSpec(proposal);
  const used = agentRefsUsedInWorkflow(proposal);
  const issues: BuilderIssueV1[] = [];

  for (const ref of used) {
    const spec = specByRef.get(ref);
    if (spec === undefined) {
      continue;
    }

    const resolved = resolution.get(ref);
    if (resolved === undefined) {
      issues.push(
        builderIssue({
          code: "MISSING_AGENT_VERSION_RESOLUTION",
          message: `Missing immutable AgentVersionId resolution for ref '${ref}'.`,
          action:
            "Publish proposed agents first, then supply the full ref→AgentVersionId map.",
          location: { kind: "agent_spec", ref },
        }),
      );
      continue;
    }

    const catalogEntry = catalog.agentVersionsById.get(resolved);
    if (catalogEntry === undefined) {
      issues.push(
        builderIssue({
          code: "UNAUTHORIZED_OR_FOREIGN_RESOURCE",
          message: `Resolved AgentVersionId '${resolved}' for ref '${ref}' is not in the workspace catalog.`,
          action: "Only map refs to AgentVersions listed for this workspace.",
          location: {
            kind: "resource",
            resource: { kind: "agentVersion", id: resolved },
          },
        }),
      );
      continue;
    }

    if (spec.kind === "EXISTING") {
      if (resolved !== spec.agentVersionId) {
        issues.push(
          builderIssue({
            code: "UNSUPPORTED_NODE_CONFIGURATION",
            message: `Resolution for ref '${ref}' must match the EXISTING agent's AgentVersionId.`,
            action: `Use AgentVersionId '${spec.agentVersionId}' for this ref.`,
            location: { kind: "agent_spec", ref },
          }),
        );
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues: sortIssuesDeterministic(issues) };
  }

  const agentRefToVersionId = new Map<
    BuilderProposalAgentRef,
    AgentVersionId
  >();
  for (const ref of proposal.agents.map((s) => s.ref)) {
    const spec = specByRef.get(ref);
    if (spec === undefined) {
      continue;
    }

    const resolved = resolution.get(ref);
    if (resolved === undefined) {
      continue;
    }

    agentRefToVersionId.set(ref, resolved);
  }

  const definition = workflowIntentToWorkflowDefinitionV3(
    proposal,
    agentRefToVersionId,
  );
  const topoIssues = tryAssertWorkflow(definition).map((issue) =>
    issue.code === "INVALID_GRAPH_TOPOLOGY"
      ? { ...issue, code: "INVALID_COMPILED_WORKFLOW_DEFINITION" as const }
      : issue,
  );
  if (topoIssues.length > 0) {
    return {
      ok: false,
      issues: sortIssuesDeterministic(topoIssues),
    };
  }

  return {
    ok: true,
    issues: [],
    workflowDefinition: definition,
    workflowDefinitionDigest: canonicalJsonStringify(
      definition as unknown as JsonValue,
    ),
  };
}

export function sortedWorkflowNodesForDeterminism(
  nodes: readonly BuilderProposalWorkflowNodeIntentV1[],
): BuilderProposalWorkflowNodeIntentV1[] {
  return [...nodes].sort((a, b) => a.key.localeCompare(b.key));
}
