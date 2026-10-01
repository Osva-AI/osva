import type {
  AgentId,
  AgentManifestV1,
  AgentVersionId,
  ArtifactId,
  ConnectorId,
  ConnectorVersionId,
  KnowledgeIndexId,
  KnowledgeSourceId,
  ModelProfileId,
  ModelProfileVersionId,
  ToolVersionId,
  WorkflowId,
  WorkflowVersionId,
} from "@osva-ai/contracts";
import { OsvaApiError, type OsvaClient } from "@osva-ai/sdk";

import type { SetupApi } from "./client.js";
import type { SetupEnv } from "./env.js";
import { stdioMcpServiceNote } from "./env.js";
import {
  buildAnalysisManifest,
  buildReportManifest,
  buildResearchManifest,
} from "./manifests.js";
import { pollUntilReady } from "./poll.js";
import type { CanonicalStateV1 } from "./state.js";
import type { DeployedTrustedRuntime } from "./deploy.js";
import {
  buildStdioMcpTransportConfig,
  readPolicyDocumentBytes,
} from "./deploy.js";
import {
  loadReferenceWorkflowDefinition,
  materializeWorkflowDefinition,
} from "./workflow.js";

export const MODEL_PROFILE_KEY = "canonical-primary-model";
export const KNOWLEDGE_SOURCE_KEY = "canonical-dependency-adoption-policy";
export const CONNECTOR_KEY = "canonical-npm-research";
export const WORKFLOW_KEY = "canonical-dependency-adoption";

const AGENT_RESEARCH_KEY = "canonical-dependency-research";
const AGENT_ANALYSIS_KEY = "canonical-dependency-analysis";
const AGENT_REPORT_KEY = "canonical-dependency-report";

const NPM_TOOLS = ["npm_package_metadata", "npm_downloads"] as const;

type SdkAgentVersionManifest = Parameters<
  OsvaClient["agents"]["createVersion"]
>[1]["manifest"];

type SdkWorkflowDefinition = Parameters<
  OsvaClient["workflows"]["createVersion"]
>[1]["definition"];

function cloneManifest(manifest: AgentManifestV1): SdkAgentVersionManifest {
  return JSON.parse(JSON.stringify(manifest)) as SdkAgentVersionManifest;
}

function cloneWorkflowDefinition(
  definition: ReturnType<typeof materializeWorkflowDefinition>,
): SdkWorkflowDefinition {
  return JSON.parse(JSON.stringify(definition)) as SdkWorkflowDefinition;
}

export async function ensureModelProfileVersion(
  api: SetupApi,
  env: SetupEnv,
): Promise<{
  modelProfileId: ModelProfileId;
  modelProfileVersionId: ModelProfileVersionId;
}> {
  let profile =
    (await api.findModelProfileByKey(MODEL_PROFILE_KEY)) ??
    (await api.createModelProfile({
      key: MODEL_PROFILE_KEY,
      name: "Canonical Primary Model",
    }));

  const versions = await api.listModelProfileVersions(profile.id);
  const matching = [...versions.versions]
    .reverse()
    .find(
      (version) =>
        version.provider === env.modelProvider && version.model === env.model,
    );
  if (matching !== undefined) {
    return {
      modelProfileId: profile.id,
      modelProfileVersionId: matching.id,
    };
  }

  const created = await api.createModelProfileVersion(profile.id, {
    provider: env.modelProvider,
    model: env.model,
  });
  return {
    modelProfileId: profile.id,
    modelProfileVersionId: created.id,
  };
}

export async function ensurePolicyArtifact(api: SetupApi) {
  const bytes = await readPolicyDocumentBytes();
  const blob = new Blob([bytes], { type: "text/markdown" });
  return api.sdk.artifacts.create({
    name: "engineering-dependency-adoption-policy.md",
    content: blob,
    mediaType: "text/markdown",
    metadata: {
      kind: "osva.canonical.dependency-adoption-policy",
      schemaVersion: "1",
    },
    idempotencyKey: "canonical-demo:policy:v1",
  });
}

export async function ensureKnowledgeSource(
  api: SetupApi,
  artifactId: ArtifactId,
): Promise<KnowledgeSourceId> {
  const listed = await api.sdk.knowledgeSources.list({ limit: "100" });
  const existing = listed.items.find(
    (source) => source.key === KNOWLEDGE_SOURCE_KEY,
  );
  if (existing !== undefined) {
    return existing.id;
  }

  const created = await api.sdk.knowledgeSources.create({
    key: KNOWLEDGE_SOURCE_KEY,
    name: "Canonical Dependency Adoption Policy",
    artifactId,
    idempotencyKey: "canonical-demo:policy-source:v1",
  });
  return created.id;
}

export async function ensureKnowledgeIndexReady(
  api: SetupApi,
  env: SetupEnv,
  knowledgeSourceId: KnowledgeSourceId,
): Promise<KnowledgeIndexId> {
  const listed = await api.sdk.knowledgeIndexes.listForSource(
    knowledgeSourceId,
    {
      limit: 100,
    },
  );
  let index = listed.items[0];
  if (index?.status === "FAILED") {
    index = await api.sdk.knowledgeIndexes.retry(index.id);
  }
  if (index === undefined) {
    index = await api.sdk.knowledgeIndexes.createForSource(knowledgeSourceId, {
      idempotencyKey: "canonical-demo:policy-index:v1",
    });
  }

  const ready = await pollUntilReady({
    label: "Knowledge index",
    intervalMs: env.knowledgePollIntervalMs,
    timeoutMs: env.knowledgePollTimeoutMs,
    fetch: () => api.sdk.knowledgeIndexes.get(index.id),
    getStatus: (value) => value.status,
    isReady: (value) => value.status === "READY",
    isFailed: (value) => value.status === "FAILED",
    onStatus: (status) => {
      console.log(`Knowledge index: ${status}`);
    },
  });

  return ready.id;
}

function transportConfigMatches(
  left: { command: string; args: readonly string[] },
  right: { command: string; args: readonly string[] },
): boolean {
  return (
    left.command === right.command &&
    left.args.length === right.args.length &&
    left.args.every((arg, index) => arg === right.args[index])
  );
}

export async function ensureConnectorVersion(
  api: SetupApi,
  deployed: DeployedTrustedRuntime,
): Promise<{
  connectorId: ConnectorId;
  connectorVersionId: ConnectorVersionId;
}> {
  const transportConfig = buildStdioMcpTransportConfig(deployed.mcpStdioEntry);
  const connector =
    (await api.findConnectorByKey(CONNECTOR_KEY)) ??
    (await api.createConnector({
      key: CONNECTOR_KEY,
      name: "Canonical npm Research Connector",
      description:
        "Read-only npm metadata connector for the canonical dependency-adoption example.",
    }));

  const versions = await api.listConnectorVersions(connector.id);
  const existing = [...versions.versions].reverse().find((version) => {
    if (version.transport !== "STDIO") {
      return false;
    }
    const config = version.transportConfig;
    if (!("command" in config) || !("args" in config)) {
      return false;
    }
    return transportConfigMatches(transportConfig, config);
  });

  if (existing !== undefined) {
    return { connectorId: connector.id, connectorVersionId: existing.id };
  }

  const created = await api.createConnectorVersion(connector.id, {
    kind: "MCP",
    transport: "STDIO",
    transportConfig,
  });
  return { connectorId: connector.id, connectorVersionId: created.id };
}

export function validateDiscoveredTools(
  tools: ReadonlyArray<{
    readonly remoteToolName: string;
    readonly inputSchema: Record<string, unknown>;
  }>,
): void {
  for (const expected of NPM_TOOLS) {
    const tool = tools.find((entry) => entry.remoteToolName === expected);
    if (tool === undefined) {
      throw new Error(
        `MCP discovery did not return required tool '${expected}'.`,
      );
    }
    const schema = tool.inputSchema;
    if (
      schema.type !== "object" ||
      !("properties" in schema) ||
      typeof schema.properties !== "object"
    ) {
      throw new Error(`MCP tool '${expected}' has an unexpected input schema.`);
    }
  }
}

export async function discoverAndImportNpmTools(
  api: SetupApi,
  connectorId: ConnectorId,
  connectorVersionId: ConnectorVersionId,
): Promise<{
  npmPackageMetadata: { toolId: string; toolVersionId: ToolVersionId };
  npmDownloads: { toolId: string; toolVersionId: ToolVersionId };
}> {
  try {
    const discovered = await api.discoverConnectorTools(
      connectorId,
      connectorVersionId,
    );
    validateDiscoveredTools(discovered.tools);
    const imported = await api.importMcpTools({
      connectorVersionId,
      tools: [
        {
          remoteToolName: "npm_package_metadata",
          toolKey: "npm_package_metadata",
          toolName: "npm package metadata",
        },
        {
          remoteToolName: "npm_downloads",
          toolKey: "npm_downloads",
          toolName: "npm downloads",
        },
      ],
    });

    const metadata = imported.imported.find(
      (entry) => entry.remoteToolName === "npm_package_metadata",
    );
    const downloads = imported.imported.find(
      (entry) => entry.remoteToolName === "npm_downloads",
    );
    if (metadata === undefined || downloads === undefined) {
      throw new Error("MCP import did not return both canonical npm tools.");
    }

    return {
      npmPackageMetadata: {
        toolId: metadata.toolId,
        toolVersionId: metadata.toolVersionId,
      },
      npmDownloads: {
        toolId: downloads.toolId,
        toolVersionId: downloads.toolVersionId,
      },
    };
  } catch (error) {
    if (error instanceof OsvaApiError) {
      throw new Error(`${error.message}\n\n${stdioMcpServiceNote}`, {
        cause: error,
      });
    }
    throw error;
  }
}

async function findAgentByKey(api: SetupApi, key: string) {
  const listed = await api.sdk.agents.list();
  return listed.agents.find((agent) => agent.key === key);
}

async function ensureAgent(
  api: SetupApi,
  key: string,
  name: string,
): Promise<AgentId> {
  const existing = await findAgentByKey(api, key);
  if (existing !== undefined) {
    return existing.id;
  }
  const created = await api.sdk.agents.create({ key, name });
  return created.id;
}

export async function createAgentVersions(
  api: SetupApi,
  input: {
    readonly modelProfileVersionId: ModelProfileVersionId;
    readonly knowledgeIndexId: KnowledgeIndexId;
    readonly tools: {
      readonly npmPackageMetadata: ToolVersionId;
      readonly npmDownloads: ToolVersionId;
    };
    readonly deployed: DeployedTrustedRuntime;
  },
): Promise<{
  research: { agentId: AgentId; agentVersionId: AgentVersionId };
  analysis: { agentId: AgentId; agentVersionId: AgentVersionId };
  report: { agentId: AgentId; agentVersionId: AgentVersionId };
}> {
  const researchAgentId = await ensureAgent(
    api,
    AGENT_RESEARCH_KEY,
    "Canonical Dependency Research",
  );
  const analysisAgentId = await ensureAgent(
    api,
    AGENT_ANALYSIS_KEY,
    "Canonical Dependency Analysis",
  );
  const reportAgentId = await ensureAgent(
    api,
    AGENT_REPORT_KEY,
    "Canonical Dependency Report",
  );

  const researchManifest = await buildResearchManifest({
    key: AGENT_RESEARCH_KEY,
    name: "Canonical Dependency Research",
    entrypoint: input.deployed.researchEntrypoint,
    integrity: input.deployed.researchIntegrity,
    modelProfileVersionId: input.modelProfileVersionId,
    knowledgeIndexId: input.knowledgeIndexId,
    toolVersionIds: {
      npmPackageMetadata: input.tools.npmPackageMetadata,
      npmDownloads: input.tools.npmDownloads,
    },
  });

  const analysisManifest = await buildAnalysisManifest({
    key: AGENT_ANALYSIS_KEY,
    name: "Canonical Dependency Analysis",
    entrypoint: input.deployed.analysisEntrypoint,
    integrity: input.deployed.analysisIntegrity,
    modelProfileVersionId: input.modelProfileVersionId,
    knowledgeIndexId: input.knowledgeIndexId,
  });

  const reportManifest = await buildReportManifest({
    key: AGENT_REPORT_KEY,
    name: "Canonical Dependency Report",
    entrypoint: input.deployed.reportEntrypoint,
    integrity: input.deployed.reportIntegrity,
    modelProfileVersionId: input.modelProfileVersionId,
  });

  const researchVersion = await api.sdk.agents.createVersion(researchAgentId, {
    manifest: cloneManifest(researchManifest),
  });
  const analysisVersion = await api.sdk.agents.createVersion(analysisAgentId, {
    manifest: cloneManifest(analysisManifest),
  });
  const reportVersion = await api.sdk.agents.createVersion(reportAgentId, {
    manifest: cloneManifest(reportManifest),
  });

  return {
    research: { agentId: researchAgentId, agentVersionId: researchVersion.id },
    analysis: { agentId: analysisAgentId, agentVersionId: analysisVersion.id },
    report: { agentId: reportAgentId, agentVersionId: reportVersion.id },
  };
}

export async function ensureWorkflowVersion(
  api: SetupApi,
  agentVersionIds: {
    readonly research: AgentVersionId;
    readonly analysis: AgentVersionId;
    readonly report: AgentVersionId;
  },
): Promise<{ workflowId: WorkflowId; workflowVersionId: WorkflowVersionId }> {
  const listed = await api.sdk.workflows.list();
  const workflow =
    listed.workflows.find((entry) => entry.key === WORKFLOW_KEY) ??
    (await api.sdk.workflows.create({
      key: WORKFLOW_KEY,
      name: "Canonical Dependency Adoption",
      description:
        "Research, analysis, approval, delivery wait, and report workflow for the canonical example.",
    }));

  const definition = materializeWorkflowDefinition(
    await loadReferenceWorkflowDefinition(),
    agentVersionIds,
  );

  const version = await api.sdk.workflows.createVersion(workflow.id, {
    definition: cloneWorkflowDefinition(definition),
  });

  return { workflowId: workflow.id, workflowVersionId: version.id };
}

export async function stateStillValid(
  api: SetupApi,
  env: SetupEnv,
  state: CanonicalStateV1,
  deployed: DeployedTrustedRuntime,
): Promise<boolean> {
  if (state.workspaceId !== env.workspaceId) {
    return false;
  }
  if (
    state.trustedRuntime.researchIntegrity !== deployed.researchIntegrity ||
    state.trustedRuntime.analysisIntegrity !== deployed.analysisIntegrity ||
    state.trustedRuntime.reportIntegrity !== deployed.reportIntegrity ||
    state.trustedRuntime.mcpStdioEntry !== deployed.mcpStdioEntry
  ) {
    return false;
  }

  try {
    await api.getModelProfileVersion(
      state.modelProfileId as ModelProfileId,
      state.modelProfileVersionId as ModelProfileVersionId,
    );
    await api.sdk.artifacts.get(state.policyArtifactId as ArtifactId);
    await api.sdk.knowledgeSources.get(
      state.knowledgeSourceId as KnowledgeSourceId,
    );
    const index = await api.sdk.knowledgeIndexes.get(
      state.knowledgeIndexId as KnowledgeIndexId,
    );
    if (index.status !== "READY") {
      return false;
    }
    await api.getConnectorVersion(
      state.connectorId as ConnectorId,
      state.connectorVersionId as ConnectorVersionId,
    );
    await api.sdk.agents.getVersion(
      state.agents.research.agentId as AgentId,
      state.agents.research.agentVersionId as AgentVersionId,
    );
    await api.sdk.workflows.getVersion(
      state.workflowId as WorkflowId,
      state.workflowVersionId as WorkflowVersionId,
    );
    return true;
  } catch (error) {
    if (error instanceof OsvaApiError && error.status === 404) {
      return false;
    }
    throw error;
  }
}

export function stateFromExisting(
  env: SetupEnv,
  deployed: DeployedTrustedRuntime,
  state: CanonicalStateV1,
): CanonicalStateV1 {
  return {
    ...state,
    workspaceId: env.workspaceId,
    updatedAt: new Date().toISOString(),
    trustedRuntime: {
      researchIntegrity: deployed.researchIntegrity,
      analysisIntegrity: deployed.analysisIntegrity,
      reportIntegrity: deployed.reportIntegrity,
      mcpStdioEntry: deployed.mcpStdioEntry,
    },
  };
}
