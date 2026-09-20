import { createFilesystemArtifactBlobStore } from "@osva/adapters-artifact-filesystem";
import { createS3ArtifactBlobStore } from "@osva/adapters-artifact-s3";
import type { ArtifactBlobStore } from "@osva/domain";

import {
  ARTIFACT_STORAGE_DRIVER_FILESYSTEM,
  ARTIFACT_STORAGE_DRIVER_S3,
  type ArtifactStorageConfig,
} from "./config.js";

export function createArtifactBlobStore(
  config: ArtifactStorageConfig,
): ArtifactBlobStore {
  if (config.driver === ARTIFACT_STORAGE_DRIVER_FILESYSTEM) {
    return createFilesystemArtifactBlobStore({
      rootDirectory: config.filesystemRoot,
    });
  }

  if (config.driver === ARTIFACT_STORAGE_DRIVER_S3) {
    return createS3ArtifactBlobStore({
      bucket: config.bucket,
      region: config.region,
      endpoint: config.endpoint,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      forcePathStyle: config.forcePathStyle,
    });
  }

  throw new Error("Unsupported artifact storage driver.");
}
