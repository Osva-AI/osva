import { buildWorkflowRunInput, parseRunArgs, ArgsError } from "./lib/args.js";
import {
  loadOperatorEnv,
  OperatorConfigurationError,
} from "./lib/operator-env.js";
import { OperatorApi, OperatorSetupError } from "./lib/operator-client.js";
import { printFailure } from "./lib/output.js";

async function main(): Promise<void> {
  let args;
  try {
    args = parseRunArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ArgsError) {
      printFailure(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  let env;
  try {
    env = loadOperatorEnv();
  } catch (error) {
    if (error instanceof OperatorConfigurationError) {
      printFailure(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const api = new OperatorApi(env);

  let state;
  try {
    state = await api.loadVerifiedCanonicalState(env.workspaceId);
  } catch (error) {
    if (error instanceof OperatorSetupError) {
      printFailure(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const input = buildWorkflowRunInput({
    requestId: args.requestId,
    packageName: args.packageName,
    useCase: args.useCase,
    constraints: args.constraints,
  });

  const created = await api.sdk.workflowRuns.create({
    workflowVersionId: state.workflowVersionId as never,
    input,
  });

  console.log("OSVA Canonical Dependency Adoption Review");
  console.log("");
  console.log(`Request ID:      ${args.requestId}`);
  console.log(`Package:         ${args.packageName}`);
  console.log(`Workflow Run:    ${created.id}`);
  console.log(`WorkflowVersion: ${state.workflowVersionId}`);
  console.log("");
  console.log(`Status: ${created.status}`);
  console.log("");
  console.log("Next:");
  console.log(`  pnpm canonical:status ${created.id}`);
}

main().catch((error: unknown) => {
  printFailure(
    error instanceof Error ? error.message : "canonical:run failed.",
  );
  process.exitCode = 1;
});
