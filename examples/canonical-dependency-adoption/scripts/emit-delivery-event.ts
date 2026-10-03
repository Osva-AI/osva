import {
  ArgsError,
  buildDeliveryEventRequest,
  extractRequestIdFromWorkflowInput,
  parseEmitDeliveryEventArgs,
} from "./lib/args.js";
import {
  loadOperatorEnv,
  OperatorConfigurationError,
} from "./lib/operator-env.js";
import { OperatorApi } from "./lib/operator-client.js";
import { printFailure } from "./lib/output.js";

async function main(): Promise<void> {
  let cli;
  try {
    cli = parseEmitDeliveryEventArgs(process.argv.slice(2));
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

  let requestId = cli.requestId;
  if (requestId.length === 0 && cli.workflowRunId !== undefined) {
    const run = await api.sdk.workflowRuns.get(cli.workflowRunId as never);
    const resolved = extractRequestIdFromWorkflowInput(run.input);
    if (resolved === null) {
      printFailure(
        "Could not resolve requestId from workflow run input. Pass requestId directly.",
      );
      process.exitCode = 1;
      return;
    }
    requestId = resolved;
  }

  if (requestId.length === 0) {
    printFailure("Missing request id.");
    process.exitCode = 1;
    return;
  }

  const body = buildDeliveryEventRequest(requestId);
  const event = await api.ingestWorkflowEvent(body);

  console.log("Delivery event recorded");
  console.log("");
  console.log(`Request ID: ${requestId}`);
  console.log(`Event ID:   ${event.id}`);
  console.log(`Source:     ${event.source}`);
  console.log(`Type:       ${event.eventType}`);
  console.log("");
  console.log("The event is durable. If the matching WAIT is not armed yet,");
  console.log("it can still satisfy that WAIT once the workflow reaches it.");
}

main().catch((error: unknown) => {
  printFailure(
    error instanceof Error
      ? error.message
      : "canonical:emit-delivery-event failed.",
  );
  process.exitCode = 1;
});
