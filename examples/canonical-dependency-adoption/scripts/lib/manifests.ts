import { readFile } from "node:fs/promises";

import type {
  AgentManifestV1,
  JsonSchemaRecord,
  KnowledgeIndexId,
  ModelProfileVersionId,
  ToolVersionId,
} from "@osva-ai/contracts";
import { AGENT_EXECUTION_DEFAULT_TIMEOUT_MS } from "@osva-ai/contracts";

import { contractSchemaPaths } from "./paths.js";

async function loadJsonSchema(filePath: string): Promise<JsonSchemaRecord> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as JsonSchemaRecord;
}

export interface AgentManifestBuildInput {
  readonly key: string;
  readonly name: string;
  readonly entrypoint: string;
  readonly integrity: string;
  readonly modelProfileVersionId: ModelProfileVersionId;
  readonly knowledgeIndexId?: KnowledgeIndexId;
  readonly toolVersionIds?: {
    readonly npmPackageMetadata: ToolVersionId;
    readonly npmDownloads: ToolVersionId;
  };
}

export async function buildResearchManifest(
  input: AgentManifestBuildInput,
): Promise<AgentManifestV1> {
  if (input.toolVersionIds === undefined) {
    throw new Error("Research manifest requires npm tool bindings.");
  }
  if (input.knowledgeIndexId === undefined) {
    throw new Error(
      "Research manifest requires policy_docs knowledge binding.",
    );
  }

  return {
    schemaVersion: "1",
    key: input.key,
    name: input.name,
    runtime: {
      type: "TRUSTED_TYPESCRIPT",
      entrypoint: input.entrypoint,
      integrity: input.integrity,
    },
    input: { schema: await loadJsonSchema(contractSchemaPaths.workflowInput) },
    output: {
      schema: await loadJsonSchema(contractSchemaPaths.researchOutput),
    },
    execution: { timeoutMs: 180_000, maxAttempts: 2 },
    capabilities: {
      model: true,
      tools: ["npm_package_metadata", "npm_downloads"],
    },
    models: {
      primary: { modelProfileVersionId: input.modelProfileVersionId },
    },
    knowledge: {
      policy_docs: { knowledgeIndexIds: [input.knowledgeIndexId] },
    },
    tools: {
      npm_package_metadata: {
        toolVersionId: input.toolVersionIds.npmPackageMetadata,
      },
      npm_downloads: {
        toolVersionId: input.toolVersionIds.npmDownloads,
      },
    },
  };
}

export async function buildAnalysisManifest(
  input: AgentManifestBuildInput,
): Promise<AgentManifestV1> {
  if (input.knowledgeIndexId === undefined) {
    throw new Error(
      "Analysis manifest requires policy_docs knowledge binding.",
    );
  }

  return {
    schemaVersion: "1",
    key: input.key,
    name: input.name,
    runtime: {
      type: "TRUSTED_TYPESCRIPT",
      entrypoint: input.entrypoint,
      integrity: input.integrity,
    },
    input: { schema: await loadJsonSchema(contractSchemaPaths.researchOutput) },
    output: {
      schema: await loadJsonSchema(contractSchemaPaths.analysisOutput),
    },
    execution: { timeoutMs: 120_000, maxAttempts: 2 },
    capabilities: {
      model: true,
      tools: [],
    },
    models: {
      primary: { modelProfileVersionId: input.modelProfileVersionId },
    },
    knowledge: {
      policy_docs: { knowledgeIndexIds: [input.knowledgeIndexId] },
    },
  };
}

export async function buildReportManifest(
  input: AgentManifestBuildInput,
): Promise<AgentManifestV1> {
  return {
    schemaVersion: "1",
    key: input.key,
    name: input.name,
    runtime: {
      type: "TRUSTED_TYPESCRIPT",
      entrypoint: input.entrypoint,
      integrity: input.integrity,
    },
    input: { schema: await loadJsonSchema(contractSchemaPaths.analysisOutput) },
    output: { schema: await loadJsonSchema(contractSchemaPaths.reportOutput) },
    execution: {
      timeoutMs: AGENT_EXECUTION_DEFAULT_TIMEOUT_MS,
      maxAttempts: 2,
    },
    capabilities: {
      model: true,
      tools: [],
    },
    models: {
      primary: { modelProfileVersionId: input.modelProfileVersionId },
    },
  };
}
