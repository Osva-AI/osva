import { loadSetupEnv, SetupConfigurationError } from "./lib/env.js";
import { SetupApi } from "./lib/client.js";
import { deployTrustedRuntimeAndMcp, runPackageBuild } from "./lib/deploy.js";
import {
  printFailure,
  printInfo,
  printSetupHeader,
  printStep,
} from "./lib/output.js";
import {
  createAgentVersions,
  discoverAndImportNpmTools,
  ensureConnectorVersion,
  ensureKnowledgeIndexReady,
  ensureKnowledgeSource,
  ensureModelProfileVersion,
  ensurePolicyArtifact,
  ensureWorkflowVersion,
  stateFromExisting,
  stateStillValid,
} from "./lib/resources.js";
import {
  readCanonicalState,
  writeCanonicalState,
  type CanonicalStateV1,
} from "./lib/state.js";
import { stateFilePath } from "./lib/paths.js";

async function main(): Promise<void> {
  printSetupHeader();

  let env;
  try {
    env = loadSetupEnv();
  } catch (error) {
    if (error instanceof SetupConfigurationError) {
      printFailure(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const api = new SetupApi(env);

  try {
    await api.verifyConnection(env.workspaceId);
    printStep("Connected to OSVA");
    printStep("Workspace verified");
  } catch (error) {
    printFailure(
      error instanceof Error ? error.message : "Failed to connect to OSVA.",
    );
    process.exitCode = 1;
    return;
  }

  printInfo(
    `Configuring primary model binding using ${env.modelProvider}/${env.model}.`,
  );

  await runPackageBuild();
  printStep("Canonical package built");

  const deployed = await deployTrustedRuntimeAndMcp(env.trustedRuntimeRoot);
  printStep("Trusted agent entrypoints deployed");
  printStep("Agent integrity verified");

  const existingState = await readCanonicalState();
  if (
    existingState !== null &&
    (await stateStillValid(api, env, existingState, deployed))
  ) {
    await writeCanonicalState(stateFromExisting(env, deployed, existingState));
    printStep("Reused existing canonical setup from verified local state");
    printStep("npm MCP connector ready");
    printStep("Research AgentVersion ready");
    printStep("Analysis AgentVersion ready");
    printStep("Report AgentVersion ready");
    printStep("WorkflowVersion ready");
    printInfo("");
    printInfo("Canonical example is ready.");
    printInfo(`WorkflowVersion: ${existingState.workflowVersionId}`);
    printInfo(`State: ${stateFilePath()}`);
    return;
  }

  const model = await ensureModelProfileVersion(api, env);
  printStep("Model profile ready");

  const policyArtifact = await ensurePolicyArtifact(api);
  printStep("Policy artifact ready");

  const knowledgeSourceId = await ensureKnowledgeSource(api, policyArtifact.id);
  printStep("Knowledge source ready");

  const knowledgeIndexId = await ensureKnowledgeIndexReady(
    api,
    env,
    knowledgeSourceId,
  );
  printStep("Knowledge index READY");

  const connector = await ensureConnectorVersion(api, deployed);
  printStep("npm MCP connector ready");

  const tools = await discoverAndImportNpmTools(
    api,
    connector.connectorId,
    connector.connectorVersionId,
  );
  printStep("npm_package_metadata imported");
  printStep("npm_downloads imported");

  const agents = await createAgentVersions(api, {
    modelProfileVersionId: model.modelProfileVersionId,
    knowledgeIndexId,
    tools: {
      npmPackageMetadata: tools.npmPackageMetadata.toolVersionId,
      npmDownloads: tools.npmDownloads.toolVersionId,
    },
    deployed,
  });
  printStep("Research AgentVersion ready");
  printStep("Analysis AgentVersion ready");
  printStep("Report AgentVersion ready");

  const workflow = await ensureWorkflowVersion(api, {
    research: agents.research.agentVersionId,
    analysis: agents.analysis.agentVersionId,
    report: agents.report.agentVersionId,
  });
  printStep("WorkflowVersion ready");

  const state: CanonicalStateV1 = {
    schemaVersion: "1",
    workspaceId: env.workspaceId,
    updatedAt: new Date().toISOString(),
    modelProfileId: model.modelProfileId,
    modelProfileVersionId: model.modelProfileVersionId,
    policyArtifactId: policyArtifact.id,
    knowledgeSourceId,
    knowledgeIndexId,
    connectorId: connector.connectorId,
    connectorVersionId: connector.connectorVersionId,
    tools: {
      npmPackageMetadata: {
        toolId: tools.npmPackageMetadata.toolId,
        toolVersionId: tools.npmPackageMetadata.toolVersionId,
      },
      npmDownloads: {
        toolId: tools.npmDownloads.toolId,
        toolVersionId: tools.npmDownloads.toolVersionId,
      },
    },
    agents,
    workflowId: workflow.workflowId,
    workflowVersionId: workflow.workflowVersionId,
    trustedRuntime: {
      researchIntegrity: deployed.researchIntegrity,
      analysisIntegrity: deployed.analysisIntegrity,
      reportIntegrity: deployed.reportIntegrity,
      mcpStdioEntry: deployed.mcpStdioEntry,
    },
  };

  await writeCanonicalState(state);

  printInfo("");
  printInfo("Canonical example is ready.");
  printInfo(`WorkflowVersion: ${workflow.workflowVersionId}`);
  printInfo(`State: ${stateFilePath()}`);
}

main().catch((error: unknown) => {
  printFailure(error instanceof Error ? error.message : "Setup failed.");
  process.exitCode = 1;
});
