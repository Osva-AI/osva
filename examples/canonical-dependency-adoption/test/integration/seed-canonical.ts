import type {
  KnowledgeIndexId,
  WorkflowDefinitionV3,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";

import { integrationAuth } from "../../../../apps/worker/test/integration/integration-auth.js";
import {
  createKnowledgeIntegrationStack,
  TEST_EMBEDDING_DEFAULTS,
} from "../../../../apps/knowledge-worker/test/integration/knowledge-stack.js";
import type { Database } from "@osva/db";
import { SetupApi } from "../../scripts/lib/client.js";
import type { DeployedTrustedRuntime } from "../../scripts/lib/deploy.js";
import { readPolicyDocumentBytes } from "../../scripts/lib/deploy.js";
import type { SetupEnv } from "../../scripts/lib/env.js";
import {
  createAgentVersions,
  discoverAndImportNpmTools,
  ensureConnectorVersion,
  ensureModelProfileVersion,
} from "../../scripts/lib/resources.js";
import { distMcpStdioDeterministicEntry } from "../../scripts/lib/paths.js";
import { loadCanonicalWorkflowDefinition } from "./workflow-fixtures.js";

export interface CanonicalSeedResult {
  readonly workflowVersionId: WorkflowVersionId;
  readonly knowledgeIndexId: KnowledgeIndexId;
  readonly modelProfileVersionId: string;
  readonly researchAgentVersionId: string;
  readonly analysisAgentVersionId: string;
  readonly reportAgentVersionId: string;
}

export async function seedKnowledgeIndex(
  database: Database,
  workspaceId: WorkspaceId,
  now: Date,
): Promise<KnowledgeIndexId> {
  const stack = await createKnowledgeIntegrationStack(database, {
    now,
    embeddingDefaults: TEST_EMBEDDING_DEFAULTS,
  });
  const { integrationControlPlaneScope, uploadTextArtifact } =
    await import("../../../../apps/knowledge-worker/test/integration/knowledge-stack.js");
  const policyBytes = await readPolicyDocumentBytes();
  const artifact = await uploadTextArtifact(
    stack,
    workspaceId,
    "engineering-dependency-adoption-policy.md",
    policyBytes.toString("utf8"),
    "text/markdown",
  );
  const source = await stack.knowledgeApp.createSource.execute(
    integrationControlPlaneScope(workspaceId),
    {
      workspaceId,
      key: "canonical-dependency-adoption-policy",
      name: "Canonical Dependency Adoption Policy",
      artifactId: artifact.id,
      attributes: {},
    },
  );
  const index = await stack.knowledgeApp.createIndex.execute(
    integrationControlPlaneScope(workspaceId),
    {
      workspaceId,
      knowledgeSourceId: source.id,
    },
  );
  await stack.ingestion.processIndex(index.id);
  const ready = await stack.knowledge.findIndexById(index.id);
  if (ready?.status !== "READY") {
    throw new Error(
      `Knowledge index did not reach READY (status=${ready?.status ?? "missing"}).`,
    );
  }
  return index.id;
}

function createSetupApi(
  origin: string,
  workspaceId: WorkspaceId,
  trustedRuntimeRoot: string,
): SetupApi {
  if (integrationAuth.token.length === 0) {
    throw new Error("Integration auth token is not bootstrapped.");
  }
  const env: SetupEnv = {
    baseUrl: origin,
    apiKey: integrationAuth.token,
    workspaceId,
    trustedRuntimeRoot,
    modelProvider: "OPENAI",
    model: "gpt-4.1-mini",
    setupTimeoutMs: 120_000,
    knowledgePollIntervalMs: 500,
    knowledgePollTimeoutMs: 120_000,
  };
  return new SetupApi(env);
}

export async function seedCanonicalPlatform(input: {
  readonly origin: string;
  readonly workspaceId: WorkspaceId;
  readonly trustedRuntimeRoot: string;
  readonly deployed: DeployedTrustedRuntime;
  readonly knowledgeIndexId: KnowledgeIndexId;
  readonly workflowDefinition?: WorkflowDefinitionV3;
}): Promise<CanonicalSeedResult> {
  const api = createSetupApi(
    input.origin,
    input.workspaceId,
    input.trustedRuntimeRoot,
  );

  const model = await ensureModelProfileVersion(api, {
    baseUrl: input.origin,
    apiKey: integrationAuth.token,
    workspaceId: input.workspaceId,
    trustedRuntimeRoot: input.trustedRuntimeRoot,
    modelProvider: "OPENAI",
    model: "gpt-4.1-mini",
    setupTimeoutMs: 120_000,
    knowledgePollIntervalMs: 500,
    knowledgePollTimeoutMs: 120_000,
  });

  const connector = await ensureConnectorVersion(api, input.deployed);

  const tools = await discoverAndImportNpmTools(
    api,
    connector.connectorId,
    connector.connectorVersionId,
  );

  const agents = await createAgentVersions(api, {
    modelProfileVersionId: model.modelProfileVersionId,
    knowledgeIndexId: input.knowledgeIndexId,
    tools: {
      npmPackageMetadata: tools.npmPackageMetadata.toolVersionId,
      npmDownloads: tools.npmDownloads.toolVersionId,
    },
    deployed: input.deployed,
  });

  const definition =
    input.workflowDefinition ??
    (await loadCanonicalWorkflowDefinition({
      research: agents.research.agentVersionId,
      analysis: agents.analysis.agentVersionId,
      report: agents.report.agentVersionId,
    }));

  const workflow = await api.sdk.workflows.create({
    key: `canonical-m6-${String(Date.now())}`,
    name: "Canonical M6 Integration",
    description: "Deterministic canonical dependency adoption E2E workflow.",
  });
  const version = await api.sdk.workflows.createVersion(workflow.id, {
    definition: JSON.parse(JSON.stringify(definition)) as never,
  });

  return {
    workflowVersionId: version.id,
    knowledgeIndexId: input.knowledgeIndexId,
    modelProfileVersionId: model.modelProfileVersionId,
    researchAgentVersionId: agents.research.agentVersionId,
    analysisAgentVersionId: agents.analysis.agentVersionId,
    reportAgentVersionId: agents.report.agentVersionId,
  };
}

export async function createWorkflowVersion(
  origin: string,
  workspaceId: WorkspaceId,
  trustedRuntimeRoot: string,
  definition: WorkflowDefinitionV3,
): Promise<WorkflowVersionId> {
  const api = createSetupApi(origin, workspaceId, trustedRuntimeRoot);
  const workflow = await api.sdk.workflows.create({
    key: `canonical-m6-${String(Date.now())}`,
    name: "Canonical M6 Variant",
    description: "Deterministic canonical workflow variant.",
  });
  const version = await api.sdk.workflows.createVersion(workflow.id, {
    definition: JSON.parse(JSON.stringify(definition)) as never,
  });
  return version.id;
}

export async function deployForIntegration(
  trustedRuntimeRoot: string,
): Promise<DeployedTrustedRuntime> {
  const { deployTrustedRuntimeAndMcp } =
    await import("../../scripts/lib/deploy.js");
  return deployTrustedRuntimeAndMcp(trustedRuntimeRoot, {
    mcpStdioEntry: distMcpStdioDeterministicEntry,
  });
}
