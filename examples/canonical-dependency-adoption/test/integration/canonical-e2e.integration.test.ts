import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ApprovalRequestId,
  ArtifactId,
  RunAttemptId,
  RunId,
  WorkflowRunId,
} from "@osva-ai/contracts";
import {
  PostgresArtifactRepository,
  PostgresRunRepository,
  PostgresWorkflowWaitRepository,
} from "@osva/db";

import {
  fetchJson,
  integrationAuth,
} from "../../../../apps/worker/test/integration/integration-auth.js";
import { buildWorkflowRunInput } from "../../scripts/lib/args.js";
import { reportArtifactIdempotencyKey } from "../../agents/src/shared/bindings.js";
import { validAnalysisOutput } from "../fixtures.js";
import {
  assertArtifactBytesMatchDigest,
  assertResearchNpmToolsInvokedOnce,
  findApprovalForWorkflowRun,
  loadLifecycleCounts,
} from "./assertions.js";
import {
  delay,
  startCanonicalInfra,
  stopCanonicalInfra,
  waitUntil,
  withCanonicalStack,
  type CanonicalInfra,
} from "./canonical-stack.js";
import { loadCanonicalWorkflowDefinition } from "./workflow-fixtures.js";
import { createWorkflowVersion } from "./seed-canonical.js";
import {
  createCanonicalWorkflowRun,
  driveFullHappyPath,
  driveHappyPathAfterApproval,
  driveUntilApprovalWaiting,
  driveUntilTerminal,
  emitDeliveryEvent,
  loadWorkflowRun,
  nodeByKey,
  rejectWorkflow,
} from "./workflow-driver.js";

function buildRequestInput(requestId: string) {
  return buildWorkflowRunInput({
    requestId,
    packageName: "zod",
    useCase:
      "Runtime validation for public API request bodies in a tier-1 service.",
    constraints: [
      "Must use a permissive license approved for SaaS distribution.",
      "Prefer packages with active maintenance in the last 12 months.",
    ],
  });
}

function reportMarkdownFor(requestId: string): string {
  return [
    "# Dependency adoption review",
    "",
    "Package: zod",
    `Request: ${requestId}`,
    "",
    "## Recommendation",
    "",
    "Disposition: **PILOT**",
    "Confidence: **HIGH**",
  ].join("\n");
}

describe("canonical dependency adoption deterministic E2E", () => {
  let infra: CanonicalInfra;

  beforeAll(async () => {
    infra = await startCanonicalInfra();
  }, 300_000);

  afterAll(async () => {
    await stopCanonicalInfra(infra);
  }, 300_000);

  it("Scenario A — happy path", async () => {
    const requestId = randomUUID();
    await withCanonicalStack(
      infra,
      { reportMarkdown: reportMarkdownFor(requestId) },
      async (stack) => {
        const workflowRunId = await createCanonicalWorkflowRun(
          stack,
          buildRequestInput(requestId),
        );
        const finalView = await driveFullHappyPath(
          stack,
          workflowRunId,
          requestId,
        );
        expect(finalView.status).toBe("SUCCEEDED");

        const nodes = nodeByKey(finalView);
        for (const key of [
          "research",
          "analysis",
          "adoption-approval",
          "delivery-wait",
          "report",
        ] as const) {
          expect(nodes[key]?.status).toBe("SUCCEEDED");
        }
        expect(nodes.research?.childRunId).toBeTruthy();
        expect(nodes.analysis?.childRunId).toBeTruthy();
        expect(nodes["adoption-approval"]?.childRunId).toBeFalsy();
        expect(nodes["delivery-wait"]?.childRunId).toBeFalsy();
        expect(nodes.report?.childRunId).toBeTruthy();

        await assertResearchNpmToolsInvokedOnce(
          stack.database,
          nodes.research!.childRunId! as RunId,
        );

        const counts = await loadLifecycleCounts(
          stack.database,
          stack.workspaceId,
          workflowRunId,
        );
        expect(counts).toMatchObject({
          workflowRuns: 1,
          workflowNodeRuns: 5,
          childRuns: 3,
          approvalRequests: 1,
          workflowWaits: 1,
          workflowEvents: 1,
          reportArtifacts: 1,
        });

        expect(
          findApprovalForWorkflowRun(
            finalView.approvalRequests as Array<{
              id: ApprovalRequestId;
              status: string;
            }>,
          ).status,
        ).toBe("APPROVED");

        const waits = new PostgresWorkflowWaitRepository(stack.database);
        const armed =
          await waits.listWorkflowWaitsByWorkflowRunId(workflowRunId);
        expect(armed[0]?.kind).toBe("EVENT");
        expect(armed[0]?.resolution).toBe("EVENT");

        const reportRunId = nodes.report!.childRunId! as RunId;
        const runs = new PostgresRunRepository(stack.database);
        const attempts = await runs.listRunAttempts(reportRunId);
        const output = attempts[0]?.output as {
          requestId: string;
          disposition: string;
          artifact: { artifactId: string };
        };
        expect(output.requestId).toBe(requestId);
        expect(output.disposition).toBe("PILOT");

        const artifactId = output.artifact.artifactId as ArtifactId;
        const { bytes } = await assertArtifactBytesMatchDigest(
          stack.database,
          stack.workspaceId,
          artifactId,
          async (id) => {
            const response = await fetch(
              `${stack.origin}/v1/artifacts/${id}/content`,
              {
                headers: { authorization: `Bearer ${integrationAuth.token}` },
              },
            );
            if (!response.ok || response.body === null) {
              throw new Error("Failed to read artifact content.");
            }
            return {
              content: response.body as unknown as NodeJS.ReadableStream,
            };
          },
        );
        const markdown = bytes.toString("utf8");
        expect(markdown).toContain(requestId);
        expect(markdown).toContain("PILOT");
        expect(markdown).toContain("HIGH");

        await stack.tickOrchestrator();
        await stack.tickOrchestrator();
        expect(
          await loadLifecycleCounts(
            stack.database,
            stack.workspaceId,
            workflowRunId,
          ),
        ).toEqual(counts);
      },
    );
  }, 300_000);

  it("Scenario B — approval rejection", async () => {
    await withCanonicalStack(infra, {}, async (stack) => {
      const requestId = randomUUID();
      const workflowRunId = await createCanonicalWorkflowRun(
        stack,
        buildRequestInput(requestId),
      );
      await driveUntilApprovalWaiting(stack, workflowRunId);
      const waiting = await loadWorkflowRun(stack.origin, workflowRunId);
      await rejectWorkflow(stack, waiting.approvalRequests[0]!.id);
      const failed = await driveUntilTerminal(stack, workflowRunId, "FAILED");
      expect(failed.error?.code).toBe("APPROVAL_REJECTED");
      expect(
        findApprovalForWorkflowRun(
          failed.approvalRequests as Array<{
            id: ApprovalRequestId;
            status: string;
          }>,
        ).status,
      ).toBe("REJECTED");
      expect(nodeByKey(failed).report).toBeUndefined();
      const counts = await loadLifecycleCounts(
        stack.database,
        stack.workspaceId,
        workflowRunId,
      );
      expect(counts.reportArtifacts).toBe(0);
      expect(counts.childRuns).toBe(2);
    });
  }, 300_000);

  it("Scenario C — event before WAIT arms", async () => {
    await withCanonicalStack(infra, {}, async (stack) => {
      const requestId = randomUUID();
      const workflowRunId = await createCanonicalWorkflowRun(
        stack,
        buildRequestInput(requestId),
      );
      const early = await emitDeliveryEvent(stack, requestId);
      await driveUntilApprovalWaiting(stack, workflowRunId);
      const finalView = await driveHappyPathAfterApproval(
        stack,
        workflowRunId,
        requestId,
        { skipDeliveryEvent: true },
      );
      expect(finalView.status).toBe("SUCCEEDED");
      const waits = new PostgresWorkflowWaitRepository(stack.database);
      const stored =
        await waits.listWorkflowWaitsByWorkflowRunId(workflowRunId);
      expect(stored[0]?.resolvedByEventId).toBe(early.eventId);
    });
  }, 300_000);

  it("Scenario D — duplicate event", async () => {
    await withCanonicalStack(infra, {}, async (stack) => {
      const requestId = randomUUID();
      const workflowRunId = await createCanonicalWorkflowRun(
        stack,
        buildRequestInput(requestId),
      );
      await driveUntilApprovalWaiting(stack, workflowRunId);
      const waiting = await loadWorkflowRun(stack.origin, workflowRunId);
      await approve(stack, waiting.approvalRequests[0]!.id);
      const idempotencyKey = `canonical-demo:delivery:${requestId}`;
      const first = await emitDeliveryEvent(stack, requestId, idempotencyKey);
      const second = await emitDeliveryEvent(stack, requestId, idempotencyKey);
      expect(second.eventId).toBe(first.eventId);
      await driveUntilTerminal(stack, workflowRunId, "SUCCEEDED");
      const counts = await loadLifecycleCounts(
        stack.database,
        stack.workspaceId,
        workflowRunId,
      );
      expect(counts.workflowEvents).toBe(1);
      expect(counts.reportArtifacts).toBe(1);
    });
  }, 300_000);

  it("Scenario E — EVENT timeout", async () => {
    await withCanonicalStack(infra, {}, async (stack) => {
      const requestId = randomUUID();
      const timeoutDefinition = await loadCanonicalWorkflowDefinition(
        {
          research: stack.seed.researchAgentVersionId as never,
          analysis: stack.seed.analysisAgentVersionId as never,
          report: stack.seed.reportAgentVersionId as never,
        },
        { deliveryWaitTimeoutMs: 100 },
      );
      const timeoutWorkflowVersionId = await createWorkflowVersion(
        stack.origin,
        stack.workspaceId,
        stack.trustedRuntimeRoot,
        timeoutDefinition,
      );
      const created = await fetchJson(`${stack.origin}/v1/workflow-runs`, {
        method: "POST",
        body: {
          workflowVersionId: timeoutWorkflowVersionId,
          input: buildRequestInput(requestId),
        },
      });
      const workflowRunId = (created.body as { id: string })
        .id as WorkflowRunId;
      await driveUntilApprovalWaiting(stack, workflowRunId);
      const waiting = await loadWorkflowRun(stack.origin, workflowRunId);
      await approve(stack, waiting.approvalRequests[0]!.id);
      await delay(150);
      const failed = await driveUntilTerminal(stack, workflowRunId, "FAILED");
      expect(failed.error?.code).toBe("WORKFLOW_EVENT_TIMEOUT");
      expect(nodeByKey(failed).report).toBeUndefined();
    });
  }, 300_000);

  it("Scenario F — same RunAttempt redelivery", async () => {
    await withCanonicalStack(infra, {}, async (stack) => {
      const requestId = randomUUID();
      const workflowRunId = await createCanonicalWorkflowRun(
        stack,
        buildRequestInput(requestId),
      );
      await driveFullHappyPath(stack, workflowRunId, requestId);
      const reportRunId = nodeByKey(
        await loadWorkflowRun(stack.origin, workflowRunId),
      ).report!.childRunId! as RunId;
      const runs = new PostgresRunRepository(stack.database);
      const runAttemptId = (await runs.listRunAttempts(reportRunId))[0]!.id;
      const before = await loadLifecycleCounts(
        stack.database,
        stack.workspaceId,
        workflowRunId,
      );
      await stack.queue.enqueue(runAttemptId);
      await waitUntil(async () => (await stack.queue.countActiveJobs()) === 0);
      const after = await loadLifecycleCounts(
        stack.database,
        stack.workspaceId,
        workflowRunId,
      );
      expect(after.reportArtifacts).toBe(before.reportArtifacts);
      expect(await runs.listRunAttempts(reportRunId)).toHaveLength(1);
    });
  }, 300_000);

  it.todo(
    "Scenario F2 — automatic second RunAttempt after failed first attempt is not implemented (manifest maxAttempts is not enforced by ExecuteRunAttempt).",
  );

  it("Scenario G — artifact same-attempt replay", async () => {
    await withCanonicalStack(infra, {}, async (stack) => {
      const requestId = randomUUID();
      const workflowRunId = await createCanonicalWorkflowRun(
        stack,
        buildRequestInput(requestId),
      );
      await driveFullHappyPath(stack, workflowRunId, requestId);
      const reportRunId = nodeByKey(
        await loadWorkflowRun(stack.origin, workflowRunId),
      ).report!.childRunId! as RunId;
      const attempt = (
        await new PostgresRunRepository(stack.database).listRunAttempts(
          reportRunId,
        )
      )[0]!;
      const before = await loadLifecycleCounts(
        stack.database,
        stack.workspaceId,
        workflowRunId,
      );
      await stack.queue.enqueue(attempt.id);
      await waitUntil(async () => (await stack.queue.countActiveJobs()) === 0);
      const after = await loadLifecycleCounts(
        stack.database,
        stack.workspaceId,
        workflowRunId,
      );
      expect(after.reportArtifacts).toBe(before.reportArtifacts);
      const artifacts = new PostgresArtifactRepository(stack.database);
      expect(
        await artifacts.findByWorkspaceIdempotencyKey(
          stack.workspaceId,
          `artifact-runtime:${attempt.id}:${reportArtifactIdempotencyKey(requestId)}`,
        ),
      ).not.toBeNull();
    });
  }, 300_000);

  it("Scenario G2 — cross-RunAttempt artifact keys differ", async () => {
    await withCanonicalStack(infra, {}, async (stack) => {
      const requestId = randomUUID();
      const analysisInput = {
        ...validAnalysisOutput,
        request: { ...validAnalysisOutput.request, requestId },
        analysis: {
          ...validAnalysisOutput.analysis,
          disposition: "PILOT" as const,
          confidence: "HIGH" as const,
        },
      };
      const createReportRun = async () => {
        const agents = await fetchJson(`${stack.origin}/v1/agents`);
        const reportAgent = (
          agents.body as { agents: Array<{ key: string; id: string }> }
        ).agents.find((agent) => agent.key === "canonical-dependency-report");
        const created = await fetchJson(`${stack.origin}/v1/runs`, {
          method: "POST",
          body: {
            agentId: reportAgent!.id,
            agentVersionId: stack.seed.reportAgentVersionId,
            input: analysisInput,
          },
        });
        expect(created.status).toBe(201);
        return created.body as {
          run: { id: string };
          runAttempt: { id: RunAttemptId };
        };
      };
      const first = await createReportRun();
      const second = await createReportRun();
      await waitForRunSucceeded(stack, first.run.id);
      await waitForRunSucceeded(stack, second.run.id);
      expect(first.runAttempt.id).not.toBe(second.runAttempt.id);
      const artifacts = new PostgresArtifactRepository(stack.database);
      const firstKey = `artifact-runtime:${first.runAttempt.id}:${reportArtifactIdempotencyKey(requestId)}`;
      const secondKey = `artifact-runtime:${second.runAttempt.id}:${reportArtifactIdempotencyKey(requestId)}`;
      expect(
        await artifacts.findByWorkspaceIdempotencyKey(
          stack.workspaceId,
          firstKey,
        ),
      ).not.toBeNull();
      expect(
        await artifacts.findByWorkspaceIdempotencyKey(
          stack.workspaceId,
          secondKey,
        ),
      ).not.toBeNull();
    });
  }, 300_000);

  it("Scenario H — orchestrator restart", async () => {
    await withCanonicalStack(infra, {}, async (stack) => {
      const requestId = randomUUID();
      const workflowRunId = await createCanonicalWorkflowRun(
        stack,
        buildRequestInput(requestId),
      );
      await driveUntilApprovalWaiting(stack, workflowRunId);
      const midCounts = await loadLifecycleCounts(
        stack.database,
        stack.workspaceId,
        workflowRunId,
      );
      await stack.replaceOrchestrator();
      const finalView = await driveHappyPathAfterApproval(
        stack,
        workflowRunId,
        requestId,
      );
      expect(finalView.status).toBe("SUCCEEDED");
      const endCounts = await loadLifecycleCounts(
        stack.database,
        stack.workspaceId,
        workflowRunId,
      );
      expect(midCounts.workflowNodeRuns).toBe(3);
      expect(endCounts.workflowNodeRuns).toBe(5);
      expect(endCounts.workflowNodeRuns).toBeGreaterThanOrEqual(
        midCounts.workflowNodeRuns,
      );
      expect(endCounts.reportArtifacts).toBe(1);
    });
  }, 300_000);
});

async function approve(stack: { origin: string }, approvalRequestId: string) {
  const decision = await fetchJson(
    `${stack.origin}/v1/approval-requests/${approvalRequestId}/decision`,
    {
      method: "POST",
      body: { decision: "APPROVED", comment: "Approved." },
    },
  );
  expect(decision.status).toBe(200);
}

async function waitForRunSucceeded(
  stack: { origin: string },
  runId: string,
): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
    if (
      run.status === 200 &&
      (run.body as { status?: string }).status === "SUCCEEDED"
    ) {
      return;
    }
    await delay(50);
  }
  throw new Error("Run did not succeed in time.");
}
