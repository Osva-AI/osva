import {
  BATCH_INFERENCE_CONTRACT_FORMAT_VERSION,
  BATCH_INFERENCE_EXECUTION_MODES,
  BATCH_INFERENCE_PROVIDER_CAPABILITIES,
  createDefaultBatchInferenceEligibilityPolicy,
  type BatchInferenceItemId,
  type BatchInferenceJobId,
  type BatchInferenceItemRequest,
  type ModelProfileVersionId,
  type ModelProviderConnectionVersionId,
  type WorkspaceId,
} from "@osva-ai/contracts";
import { AUTHORIZATION_ACTIONS } from "@osva-ai/contracts";

import { computeBatchInferenceRequestMaterialHash } from "./batch-inference-request-identity.js";
import { DomainInvariantError } from "./errors.js";
import { BatchInferenceJobNotFoundError } from "./errors.js";
import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
} from "./control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "./control-plane-resource-kinds.js";
import type { ModelProfileRepository } from "./ports/model-profile-repository.js";
import type { ModelProviderConnectionRepository } from "./ports/model-provider-connection-repository.js";
import type {
  BatchInferenceJobRecord,
  BatchInferenceJobRepository,
  WorkspaceBatchInferencePolicyRepository,
} from "./ports/batch-inference-job-repository.js";
import type { ControlPlaneScope } from "./control-plane.js";

const BATCH_INFERENCE_RESOURCE = {
  kind: CONTROL_PLANE_RESOURCE_KINDS.batchInferenceJob,
} as const;

export interface BatchInferenceApplicationClock {
  now(): Date;
}

export interface BatchInferenceApplicationIds {
  createJobId(): BatchInferenceJobId;
  createItemId(): BatchInferenceItemId;
}

export interface BatchInferenceApplicationDependencies {
  readonly jobs: BatchInferenceJobRepository;
  readonly batchPolicies: WorkspaceBatchInferencePolicyRepository;
  readonly modelProfiles: ModelProfileRepository;
  readonly modelProviderConnections: ModelProviderConnectionRepository;
  readonly clock: BatchInferenceApplicationClock;
  readonly ids: BatchInferenceApplicationIds;
}

export interface CreateBatchInferenceJobCommand {
  readonly workspaceId: WorkspaceId;
  /** Client-supplied idempotency key (not a content hash). */
  readonly clientIdempotencyKey: string;
  readonly modelProfileVersionId: ModelProfileVersionId;
  readonly providerConnectionVersionId: ModelProviderConnectionVersionId;
  readonly items: readonly BatchInferenceItemRequest[];
}

export class CreateBatchInferenceJob {
  constructor(private readonly deps: BatchInferenceApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: CreateBatchInferenceJobCommand,
  ): Promise<{ readonly job: BatchInferenceJobRecord }> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.EXECUTE,
      BATCH_INFERENCE_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    if (workspaceId !== command.workspaceId) {
      throw new Error("workspace mismatch");
    }

    const requestMaterialHash = computeBatchInferenceRequestMaterialHash({
      modelProfileVersionId: command.modelProfileVersionId,
      providerConnectionVersionId: command.providerConnectionVersionId,
      items: command.items.map((item) => ({
        providerCorrelationId: item.providerCorrelationId,
        input: item.input,
      })),
    });

    const existing = await this.deps.jobs.findJobBySubmissionFingerprint(
      workspaceId,
      command.clientIdempotencyKey,
    );
    if (existing !== null) {
      const compatibleBindings =
        existing.modelProfileVersionId === command.modelProfileVersionId &&
        existing.providerConnectionVersionId ===
          command.providerConnectionVersionId;
      if (!compatibleBindings) {
        throw new Error("batch idempotency key conflict");
      }
      const existingMaterialHash = existing.requestMaterialHash ?? "";
      if (
        existingMaterialHash !== "" &&
        requestMaterialHash !== "" &&
        existingMaterialHash !== requestMaterialHash
      ) {
        throw new Error("batch idempotency key conflict");
      }
      return { job: existing };
    }

    const policy =
      (await this.deps.batchPolicies.findPolicyByWorkspaceId(workspaceId)) ??
      createDefaultBatchInferenceEligibilityPolicy();
    if (!policy.batchInferenceEnabled) {
      throw new Error("batch inference disabled for workspace");
    }

    const version = await this.deps.modelProfiles.findModelProfileVersionById(
      command.modelProfileVersionId,
    );
    if (version === null) {
      throw new Error("model profile version not found");
    }

    const connection =
      await this.deps.modelProviderConnections.findConnectionVersionById(
        command.providerConnectionVersionId,
      );
    if (connection === null) {
      throw new Error("provider connection version not found");
    }

    const capabilities =
      BATCH_INFERENCE_PROVIDER_CAPABILITIES[version.provider];
    if (!capabilities.supportsNativeBatch) {
      throw new Error("provider does not support native batch");
    }
    if (
      policy.allowedProviders !== undefined &&
      !policy.allowedProviders.includes(version.provider)
    ) {
      throw new Error("provider not allowed by batch policy");
    }

    const maxItems = policy.maxItemCount ?? command.items.length;
    if (command.items.length > maxItems) {
      throw new Error("batch item count exceeds policy limit");
    }

    const now = this.deps.clock.now();
    const jobId = this.deps.ids.createJobId();

    const job: BatchInferenceJobRecord = {
      id: jobId,
      workspaceId,
      status: "CREATED",
      provider: version.provider,
      modelProfileVersionId: command.modelProfileVersionId,
      providerConnectionVersionId: command.providerConnectionVersionId,
      providerModelId: version.model,
      submissionFingerprint: command.clientIdempotencyKey,
      requestMaterialHash,
      pricingSnapshotId: command.modelProfileVersionId,
      pricingSnapshot: version.pricing,
      reconciliationRequired: false,
      progressTotal: command.items.length,
      progressPending: command.items.length,
      progressProcessing: 0,
      progressSucceeded: 0,
      progressFailed: 0,
      progressCancelled: 0,
      progressExpired: 0,
      reconcileAfterAt: now,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.deps.jobs.createJobWithItems({
        job,
        items: command.items.map((item) => ({
          id: item.itemId,
          jobId,
          workspaceId,
          providerCorrelationId: item.providerCorrelationId,
          status: "PENDING",
          input: item.input,
        })),
      });
    } catch (error) {
      const raced = await this.deps.jobs.findJobBySubmissionFingerprint(
        workspaceId,
        command.clientIdempotencyKey,
      );
      if (raced !== null) {
        const racedMaterialHash = raced.requestMaterialHash ?? "";
        const sameRequest =
          racedMaterialHash === requestMaterialHash ||
          (racedMaterialHash === "" &&
            raced.modelProfileVersionId === command.modelProfileVersionId &&
            raced.providerConnectionVersionId ===
              command.providerConnectionVersionId &&
            raced.progressTotal === command.items.length);
        if (!sameRequest) {
          throw new Error("batch idempotency key conflict");
        }
        return { job: raced };
      }
      if (error instanceof DomainInvariantError) {
        throw error;
      }
      throw error;
    }

    return { job };
  }
}

export class GetBatchInferenceJob {
  constructor(private readonly deps: BatchInferenceApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    jobId: BatchInferenceJobId,
  ): Promise<{ readonly job: BatchInferenceJobRecord }> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      BATCH_INFERENCE_RESOURCE,
    );
    const job = await this.deps.jobs.findJobById(
      controlPlaneWorkspaceId(scope),
      jobId,
    );
    if (job === null) {
      throw new BatchInferenceJobNotFoundError(jobId);
    }
    return { job };
  }
}

export class ListBatchInferenceJobs {
  constructor(private readonly deps: BatchInferenceApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    options: { readonly limit: number; readonly cursor?: string },
  ) {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      BATCH_INFERENCE_RESOURCE,
    );
    return this.deps.jobs.listJobs(controlPlaneWorkspaceId(scope), options);
  }
}

export class ListBatchInferenceJobItems {
  constructor(private readonly deps: BatchInferenceApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    jobId: BatchInferenceJobId,
    options: { readonly limit: number; readonly cursor?: string },
  ) {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      BATCH_INFERENCE_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const job = await this.deps.jobs.findJobById(workspaceId, jobId);
    if (job === null) {
      throw new BatchInferenceJobNotFoundError(jobId);
    }
    return this.deps.jobs.listItemsByJobId(workspaceId, jobId, options);
  }
}

export class CancelBatchInferenceJob {
  constructor(private readonly deps: BatchInferenceApplicationDependencies) {}

  async execute(scope: ControlPlaneScope, jobId: BatchInferenceJobId) {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.EXECUTE,
      BATCH_INFERENCE_RESOURCE,
    );
    const ok = await this.deps.jobs.requestCancellation(
      controlPlaneWorkspaceId(scope),
      jobId,
    );
    if (!ok) {
      throw new Error("batch job cannot be cancelled");
    }
    const job = await this.deps.jobs.findJobById(
      controlPlaneWorkspaceId(scope),
      jobId,
    );
    if (job === null) {
      throw new BatchInferenceJobNotFoundError(jobId);
    }
    return { job };
  }
}

export interface BatchInferenceApplication {
  readonly createBatchInferenceJob: CreateBatchInferenceJob;
  readonly getBatchInferenceJob: GetBatchInferenceJob;
  readonly listBatchInferenceJobs: ListBatchInferenceJobs;
  readonly listBatchInferenceJobItems: ListBatchInferenceJobItems;
  readonly cancelBatchInferenceJob: CancelBatchInferenceJob;
}

export function createBatchInferenceApplication(
  deps: BatchInferenceApplicationDependencies,
): BatchInferenceApplication {
  return {
    createBatchInferenceJob: new CreateBatchInferenceJob(deps),
    getBatchInferenceJob: new GetBatchInferenceJob(deps),
    listBatchInferenceJobs: new ListBatchInferenceJobs(deps),
    listBatchInferenceJobItems: new ListBatchInferenceJobItems(deps),
    cancelBatchInferenceJob: new CancelBatchInferenceJob(deps),
  };
}

export const BATCH_INFERENCE_DEFAULT_EXECUTION_MODE =
  BATCH_INFERENCE_EXECUTION_MODES[0];
export const BATCH_INFERENCE_API_FORMAT_VERSION =
  BATCH_INFERENCE_CONTRACT_FORMAT_VERSION;
