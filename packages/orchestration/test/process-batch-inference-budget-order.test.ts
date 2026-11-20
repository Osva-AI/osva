import { describe, expect, it, vi } from "vitest";

import { ProcessBatchInferenceJobs } from "../src/process-batch-inference-jobs.js";

describe("ProcessBatchInferenceJobs budget submit order", () => {
  it("S3: budget denial never calls adapter.submit", async () => {
    const submit = vi.fn();
    const processor = new ProcessBatchInferenceJobs({
      jobs: {
        findDueJobs: vi.fn(async () => [
          {
            id: "job-1",
            workspaceId: "ws-1",
            status: "CREATED",
            provider: "OPENAI",
            providerModelId: "gpt",
            modelProfileVersionId: "mpv",
            providerConnectionVersionId: "conn",
            submissionFingerprint: "fp",
            reconciliationRequired: false,
            progressTotal: 1,
            progressPending: 1,
            progressProcessing: 0,
            progressSucceeded: 0,
            progressFailed: 0,
            progressCancelled: 0,
            progressExpired: 0,
            requestMaterialHash: "h",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
        claimSubmissionLease: vi.fn(async () => true),
        markSubmitting: vi.fn(async () => true),
        markSubmissionAmbiguous: vi.fn(async () => undefined),
        markSubmitted: vi.fn(),
        listItemsForJob: vi.fn(),
        updateJobProgress: vi.fn(),
        updateItemOutcome: vi.fn(),
      } as never,
      resolveAdapter: vi.fn(async () => ({
        submit,
        getStatus: vi.fn(),
      })) as never,
      loadItems: vi.fn(async () => [
        {
          id: "item-1",
          jobId: "job-1",
          workspaceId: "ws-1",
          providerCorrelationId: "c1",
          status: "PENDING",
          input: { messages: [{ role: "user", content: "x" }] },
        },
      ]) as never,
      clock: { now: () => new Date() },
      workerId: "worker-1",
      submitBudget: {
        admitBeforeSubmit: vi.fn(async () => ({
          kind: "DENIED" as const,
          code: "budget_period_exhausted",
        })),
      },
    });

    await processor.execute({ batchLimit: 1 });
    expect(submit).not.toHaveBeenCalled();
  });

  it("S4: marks provider started before adapter.submit", async () => {
    const order: string[] = [];
    const submit = vi.fn(async () => {
      order.push("submit");
      return {
        providerBatchId: "pb",
        providerJobStatus: "IN_PROGRESS" as const,
      };
    });
    const markAllProviderStartedBeforeSubmit = vi.fn(async () => {
      order.push("provider_started");
    });
    const processor = new ProcessBatchInferenceJobs({
      jobs: {
        findDueJobs: vi.fn(async () => [
          {
            id: "job-2",
            workspaceId: "ws-1",
            status: "CREATED",
            provider: "OPENAI",
            providerModelId: "gpt",
            modelProfileVersionId: "mpv",
            providerConnectionVersionId: "conn",
            submissionFingerprint: "fp",
            reconciliationRequired: false,
            progressTotal: 1,
            progressPending: 1,
            progressProcessing: 0,
            progressSucceeded: 0,
            progressFailed: 0,
            progressCancelled: 0,
            progressExpired: 0,
            requestMaterialHash: "h",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
        claimSubmissionLease: vi.fn(async () => true),
        markSubmitting: vi.fn(async () => true),
        markSubmitted: vi.fn(async () => true),
        markSubmissionAmbiguous: vi.fn(),
        updateJobProgress: vi.fn(),
        listItemsForJob: vi.fn(),
        updateItemOutcome: vi.fn(),
      } as never,
      resolveAdapter: vi.fn(async () => ({
        submit,
        getStatus: vi.fn(),
      })) as never,
      loadItems: vi.fn(async () => [
        {
          id: "item-1",
          jobId: "job-2",
          workspaceId: "ws-1",
          providerCorrelationId: "c1",
          status: "PENDING",
          input: { messages: [{ role: "user", content: "x" }] },
        },
      ]) as never,
      clock: { now: () => new Date() },
      workerId: "worker-1",
      submitBudget: {
        admitBeforeSubmit: vi.fn(async () => ({
          kind: "ADMITTED" as const,
          markAllProviderStartedBeforeSubmit,
          rollbackNeverSubmitted: vi.fn(),
          markSubmitUncertain: vi.fn(),
        })),
      },
    });

    await processor.execute({ batchLimit: 1 });
    expect(markAllProviderStartedBeforeSubmit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["provider_started", "submit"]);
  });

  it("S5: local ack lost after provider accept marks submit uncertain", async () => {
    const submit = vi.fn(async () => ({
      providerBatchId: "pb",
      providerJobStatus: "IN_PROGRESS" as const,
    }));
    const markSubmitUncertain = vi.fn();
    const markSubmissionAmbiguous = vi.fn();
    const processor = new ProcessBatchInferenceJobs({
      jobs: {
        findDueJobs: vi.fn(async () => [
          {
            id: "job-3",
            workspaceId: "ws-1",
            status: "CREATED",
            provider: "OPENAI",
            providerModelId: "gpt",
            modelProfileVersionId: "mpv",
            providerConnectionVersionId: "conn",
            submissionFingerprint: "fp",
            reconciliationRequired: false,
            progressTotal: 1,
            progressPending: 1,
            progressProcessing: 0,
            progressSucceeded: 0,
            progressFailed: 0,
            progressCancelled: 0,
            progressExpired: 0,
            requestMaterialHash: "h",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
        claimSubmissionLease: vi.fn(async () => true),
        markSubmitting: vi.fn(async () => true),
        markSubmitted: vi.fn(async () => false),
        markSubmissionAmbiguous,
        listItemsForJob: vi.fn(),
        updateJobProgress: vi.fn(),
        updateItemOutcome: vi.fn(),
      } as never,
      resolveAdapter: vi.fn(async () => ({
        submit,
        getStatus: vi.fn(),
      })) as never,
      loadItems: vi.fn(async () => [
        {
          id: "item-1",
          jobId: "job-3",
          workspaceId: "ws-1",
          providerCorrelationId: "c1",
          status: "PENDING",
          input: { messages: [{ role: "user", content: "x" }] },
        },
      ]) as never,
      clock: { now: () => new Date() },
      workerId: "worker-1",
      submitBudget: {
        admitBeforeSubmit: vi.fn(async () => ({
          kind: "ADMITTED" as const,
          markAllProviderStartedBeforeSubmit: vi.fn(),
          rollbackNeverSubmitted: vi.fn(),
          markSubmitUncertain,
        })),
      },
    });

    await processor.execute({ batchLimit: 1 });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(markSubmitUncertain).toHaveBeenCalledTimes(1);
    expect(markSubmissionAmbiguous).toHaveBeenCalledWith(
      "job-3",
      "provider_accepted_local_ack_lost",
    );
  });
});
