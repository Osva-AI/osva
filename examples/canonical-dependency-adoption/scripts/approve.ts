import { ArgsError, parseApproveArgs } from "./lib/args.js";
import {
  loadOperatorEnv,
  OperatorConfigurationError,
} from "./lib/operator-env.js";
import { OperatorApi } from "./lib/operator-client.js";
import { printFailure } from "./lib/output.js";
import {
  ApprovalCommandError,
  selectPendingApprovalForDecision,
} from "./lib/workflow-status.js";

async function main(): Promise<void> {
  let cli;
  try {
    cli = parseApproveArgs(process.argv.slice(2));
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

  let approval;
  try {
    approval = selectPendingApprovalForDecision(run);
  } catch (error) {
    if (error instanceof ApprovalCommandError) {
      printFailure(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  if (approval.status !== "PENDING") {
    printFailure(
      `Approval request ${approval.id} is already ${approval.status}.`,
    );
    process.exitCode = 1;
    return;
  }

  const updated = await api.sdk.approvals.decide(approval.id, {
    decision: cli.decision,
    ...(cli.comment === undefined ? {} : { comment: cli.comment }),
  });

  console.log("Approval updated");
  console.log("");
  console.log(`Workflow Run: ${run.id}`);
  console.log(`Approval:     ${updated.id}`);
  console.log(`Decision:     ${cli.decision}`);
  if (cli.comment !== undefined) {
    console.log(`Comment:      ${cli.comment}`);
  }
  console.log("");
  console.log("The workflow will reconcile asynchronously.");
  console.log("");
  console.log("Next:");
  console.log(`  pnpm canonical:status ${run.id}`);
}

main().catch((error: unknown) => {
  printFailure(
    error instanceof Error ? error.message : "canonical:approve failed.",
  );
  process.exitCode = 1;
});
