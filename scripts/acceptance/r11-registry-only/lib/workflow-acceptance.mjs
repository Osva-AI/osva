import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const EVENT_SOURCE = "r11.registry";
const EVENT_TYPE = "r11.resume";

/**
 * Runs APPROVAL+WAIT workflow using published @osva-ai/sdk in installRoot.
 *
 * @param {string} installRoot npm consumer project with @osva-ai/sdk installed
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {number} deadlineMs
 */
export async function runPublishedWorkflowAcceptance(
  installRoot,
  baseUrl,
  apiKey,
  deadlineMs,
) {
  const correlationKey = `r11-${randomUUID()}`;
  const workflowKey = `r11-wf-${randomUUID().slice(0, 8)}`;
  const scriptPath = path.join(installRoot, "workflow-acceptance.mjs");
  await writeFile(
    scriptPath,
    buildWorkflowScript({
      baseUrl,
      apiKey,
      correlationKey,
      workflowKey,
      deadlineMs,
    }),
  );
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: installRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `Workflow acceptance failed: ${result.stderr || result.stdout}`,
    );
  }
  return JSON.parse(result.stdout.trim());
}

/**
 * @param {object} options
 * @param {string} options.baseUrl
 * @param {string} options.apiKey
 * @param {string} options.correlationKey
 * @param {string} options.workflowKey
 * @param {number} options.deadlineMs
 */
function buildWorkflowScript(options) {
  const { baseUrl, apiKey, correlationKey, workflowKey, deadlineMs } = options;
  return `import { randomUUID } from "node:crypto";
import { OsvaClient } from "@osva-ai/sdk";

const client = new OsvaClient({
  baseUrl: ${JSON.stringify(baseUrl)},
  apiKey: ${JSON.stringify(apiKey)},
  timeoutMs: 60_000,
});

const definition = {
  schemaVersion: "3",
  nodes: [
    {
      key: "r11-approval",
      type: "APPROVAL",
      title: "R11 registry approval",
      description: "Registry-only APPROVAL acceptance node.",
    },
    {
      key: "r11-wait",
      type: "WAIT",
      wait: {
        kind: "EVENT",
        source: ${JSON.stringify(EVENT_SOURCE)},
        eventType: ${JSON.stringify(EVENT_TYPE)},
        correlation: { kind: "LITERAL", value: ${JSON.stringify(correlationKey)} },
        timeoutMs: 120_000,
      },
    },
  ],
  edges: [{ from: "r11-approval", to: "r11-wait" }],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForApprovalPending(workflowRunId) {
  const deadline = Date.now() + ${deadlineMs};
  while (Date.now() < deadline) {
    const view = await client.workflowRuns.get(workflowRunId);
    if (view.status === "FAILED") {
      throw new Error(\`WorkflowRun failed: \${JSON.stringify(view.error ?? {})}\`);
    }
    const approvalNode = view.nodeRuns.find((n) => n.workflowNodeKey === "r11-approval");
    if (
      view.status === "WAITING" &&
      approvalNode?.status === "WAITING" &&
      view.approvalRequests.some((item) => item.status === "PENDING")
    ) {
      return view;
    }
    await sleep(2000);
  }
  throw new Error("Timed out waiting for APPROVAL PENDING.");
}

async function waitForWaitNode(workflowRunId) {
  const deadline = Date.now() + ${deadlineMs};
  while (Date.now() < deadline) {
    const view = await client.workflowRuns.get(workflowRunId);
    const waitNode = view.nodeRuns.find((n) => n.workflowNodeKey === "r11-wait");
    if (waitNode?.status === "WAITING" && view.status === "WAITING") return;
    if (view.status === "FAILED") {
      throw new Error(\`WorkflowRun failed before WAIT: \${JSON.stringify(view.error ?? {})}\`);
    }
    await sleep(2000);
  }
  throw new Error("Timed out waiting for WAIT node.");
}

async function waitForSucceeded(workflowRunId) {
  const deadline = Date.now() + ${deadlineMs};
  while (Date.now() < deadline) {
    const view = await client.workflowRuns.get(workflowRunId);
    if (view.status === "SUCCEEDED") return view;
    if (view.status === "FAILED") {
      throw new Error(\`WorkflowRun failed: \${JSON.stringify(view.error ?? {})}\`);
    }
    await sleep(2000);
  }
  throw new Error("Timed out waiting for SUCCEEDED.");
}

const workflow = await client.workflows.create({
  key: ${JSON.stringify(workflowKey)},
  name: "R11 registry APPROVAL+WAIT",
  description: "Published-artifact acceptance workflow fixture.",
});
const version = await client.workflows.createVersion(workflow.id, { definition });
const run = await client.workflowRuns.create({
  workflowVersionId: version.id,
  input: { correlationKey: ${JSON.stringify(correlationKey)} },
});

const approvalView = await waitForApprovalPending(run.id);
const pending = approvalView.approvalRequests.find((item) => item.status === "PENDING");
if (!pending) throw new Error("Missing PENDING approval.");

await client.approvals.decide(pending.id, {
  decision: "APPROVED",
  comment: "Approved in R1.1.3B registry acceptance.",
});

await waitForWaitNode(run.id);

await client.workflowEvents.ingest({
  source: ${JSON.stringify(EVENT_SOURCE)},
  eventType: ${JSON.stringify(EVENT_TYPE)},
  correlationKey: ${JSON.stringify(correlationKey)},
  idempotencyKey: randomUUID(),
  payload: { accepted: true },
});

const terminal = await waitForSucceeded(run.id);
const waitNode = terminal.nodeRuns.find((n) => n.workflowNodeKey === "r11-wait");
if (waitNode?.status !== "SUCCEEDED") {
  throw new Error(\`Expected wait node SUCCEEDED, got \${waitNode?.status ?? "missing"}\`);
}

console.log(JSON.stringify({
  workflowId: workflow.id,
  workflowVersionId: version.id,
  workflowRunId: run.id,
  approvalRequestId: pending.id,
  correlationKey: ${JSON.stringify(correlationKey)},
}));
`;
}
