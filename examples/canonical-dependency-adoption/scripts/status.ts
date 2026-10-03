import type { WorkflowId } from "@osva-ai/contracts";
import { ArgsError, parseStatusArgs } from "./lib/args.js";
import {
  loadOperatorEnv,
  OperatorConfigurationError,
} from "./lib/operator-env.js";
import { OperatorApi } from "./lib/operator-client.js";
import { printFailure } from "./lib/output.js";
import { approvalTitlesFromDefinition } from "./lib/workflow-definition.js";
import {
  buildWorkflowStatusView,
  renderWorkflowStatusLines,
} from "./lib/workflow-status.js";

async function main(): Promise<void> {
  let cli;
  try {
    cli = parseStatusArgs(process.argv.slice(2));
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
  const run = await api.sdk.workflowRuns.get(cli.workflowRunId as never);

  let approvalTitles = new Map<string, string>();
  try {
    const version = await api.sdk.workflows.getVersion(
      run.workflowId as WorkflowId,
      run.workflowVersionId as never,
    );
    approvalTitles = approvalTitlesFromDefinition(version.definition);
  } catch {
    // Title enrichment is optional.
  }

  const view = await buildWorkflowStatusView(api, run, approvalTitles);
  for (const line of renderWorkflowStatusLines(view)) {
    console.log(line);
  }
}

main().catch((error: unknown) => {
  printFailure(
    error instanceof Error ? error.message : "canonical:status failed.",
  );
  process.exitCode = 1;
});
