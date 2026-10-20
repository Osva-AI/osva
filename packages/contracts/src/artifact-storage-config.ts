import type { ArtifactBlobStore } from "./artifact-blob-store.js";

export const ARTIFACT_STORAGE_DRIVER_FILESYSTEM = "filesystem" as const;
export const ARTIFACT_STORAGE_DRIVER_S3 = "s3" as const;
export const ARTIFACT_STORAGE_DRIVER_REGISTERED = "registered" as const;

export const ARTIFACT_STORAGE_DRIVERS = [
  ARTIFACT_STORAGE_DRIVER_FILESYSTEM,
  ARTIFACT_STORAGE_DRIVER_S3,
  ARTIFACT_STORAGE_DRIVER_REGISTERED,
] as const;

export type ArtifactStorageDriver = (typeof ARTIFACT_STORAGE_DRIVERS)[number];

export const DEFAULT_ARTIFACT_FILESYSTEM_ROOT = ".osva/artifacts";
export const DEFAULT_ARTIFACT_MAX_BYTES = 67_108_864;

export interface ArtifactStorageConfigFilesystem {
  readonly driver: typeof ARTIFACT_STORAGE_DRIVER_FILESYSTEM;
  readonly filesystemRoot: string;
  readonly maxBytes: number;
}

export interface ArtifactStorageConfigS3 {
  readonly driver: typeof ARTIFACT_STORAGE_DRIVER_S3;
  readonly maxBytes: number;
  readonly bucket: string;
  readonly region: string;
  readonly endpoint?: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly forcePathStyle: boolean;
}

/**
 * Trusted-operator registration: `registerModule` must resolve to an
 * independently installed package that exports `createArtifactBlobStore`.
 * OSVA does not discover or download adapter packages automatically.
 */
export interface ArtifactStorageConfigRegistered {
  readonly driver: typeof ARTIFACT_STORAGE_DRIVER_REGISTERED;
  readonly maxBytes: number;
  readonly registerModule: string;
}

export type ArtifactStorageConfig =
  | ArtifactStorageConfigFilesystem
  | ArtifactStorageConfigS3
  | ArtifactStorageConfigRegistered;

export type RegisteredArtifactBlobStoreFactory = (
  config: ArtifactStorageConfigRegistered,
) => ArtifactBlobStore | Promise<ArtifactBlobStore>;

/**
 * Module shape for `OSVA_ARTIFACT_BLOB_STORE_REGISTER_MODULE`.
 */
export interface RegisteredArtifactBlobStoreModule {
  createArtifactBlobStore: RegisteredArtifactBlobStoreFactory;
}
