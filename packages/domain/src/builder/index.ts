export type {
  BuilderProposalV1,
  BuilderProposalAgentRef,
  BuilderProposalAgentSpecV1,
  BuilderProposalNewAgentV1,
  BuilderProposalExistingAgentV1,
  BuilderProposalWorkflowIntentV1,
  BuilderProposalWorkflowNodeIntentV1,
  BuilderProposalWorkflowRegistryV1,
} from "./builder-proposal.js";
export {
  BUILDER_PROPOSAL_SCHEMA_VERSION,
  BUILDER_PROPOSAL_AGENT_REF_PREFIX,
} from "./builder-proposal.js";

export type {
  BuilderIssueV1,
  BuilderIssueCode,
  BuilderIssueSeverity,
} from "./builder-issue.js";
export { builderIssue, sortIssuesDeterministic } from "./builder-issue.js";

export {
  parseBuilderProposalV1,
  BUILDER_PROPOSAL_AGENT_REF_PATTERN,
} from "./builder-proposal-schema.js";

export type {
  WorkspaceBuilderCapabilityCatalogV1,
  WorkspaceBuilderAgentVersionCatalogEntryV1,
  WorkspaceBuilderModelProfileVersionCatalogEntryV1,
  WorkspaceBuilderToolVersionCatalogEntryV1,
  WorkspaceBuilderCapabilityCatalogDependencies,
} from "./workspace-builder-capability-catalog.js";
export { GetWorkspaceBuilderCapabilityCatalog } from "./workspace-builder-capability-catalog.js";

export type {
  BuilderCatalogIndexV1,
  BuilderPrePublicationCompileResultV1,
  BuilderResolvedCompileResultV1,
} from "./builder-compiler.js";
export {
  buildBuilderCatalogIndex,
  compileBuilderProposalPrePublication,
  compileBuilderProposalResolved,
  compileDeclarativeManifestFromNewAgent,
} from "./builder-compiler.js";
