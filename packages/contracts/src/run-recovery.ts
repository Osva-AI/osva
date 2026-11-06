export const DEFAULT_MAX_RECOVERY_ATTEMPTS = 5;

export const RUN_RECOVERY_METADATA_VERSION = "1" as const;

export interface RunRecoveryMetadataV1 {
  readonly version: typeof RUN_RECOVERY_METADATA_VERSION;
  readonly recoveryAttemptCount: number;
  readonly automaticRecoveryEnabled: boolean;
  readonly lastRecoveryAt?: string;
  readonly blocked?: {
    readonly code: string;
    readonly message: string;
    readonly at: string;
  };
}
