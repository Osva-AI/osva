/**
 * Optional enqueue/cancel boundary hooks for adapter tests and acceptance.
 * Only active when explicitly passed via BullMqJobQueueOptions.enqueueClaimTestHooks.
 */

export interface EnqueueClaimHookContext {
  readonly jobId: string;
  readonly claimKey: string;
  readonly jobKey: string;
}

export interface EnqueueCancelHookContext {
  readonly jobId: string;
  readonly claimKey: string;
}

export interface EnqueueClaimTestHooks {
  readonly beforeClaim?: (
    context: EnqueueClaimHookContext,
  ) => void | Promise<void>;
  readonly afterClaimBeforeAdd?: (
    context: EnqueueClaimHookContext,
  ) => void | Promise<void>;
  readonly afterAddBeforeReturn?: (
    context: EnqueueClaimHookContext,
  ) => void | Promise<void>;
  readonly beforeCancelRemove?: (
    context: EnqueueCancelHookContext,
  ) => void | Promise<void>;
  readonly afterCancelRemoveBeforeClaimClear?: (
    context: EnqueueCancelHookContext,
  ) => void | Promise<void>;
}

export type EnqueueClaimTestHooksInput = EnqueueClaimTestHooks | undefined;
