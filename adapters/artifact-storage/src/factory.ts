import { createFilesystemArtifactBlobStore } from "@osva/adapters-artifact-filesystem";
import { createS3ArtifactBlobStore } from "@osva/adapters-artifact-s3";
import {
  ARTIFACT_STORAGE_DRIVER_FILESYSTEM,
  ARTIFACT_STORAGE_DRIVER_REGISTERED,
  ARTIFACT_STORAGE_DRIVER_S3,
  type ArtifactBlobStore,
  type ArtifactStorageConfig,
} from "@osva-ai/contracts";

import { resolveArtifactBlobStore } from "./registered-loader.js";

function createBuiltInArtifactBlobStore(
  config: Exclude<
    ArtifactStorageConfig,
    { driver: typeof ARTIFACT_STORAGE_DRIVER_REGISTERED }
  >,
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

export function createArtifactBlobStore(
  config: ArtifactStorageConfig,
): ArtifactBlobStore {
  if (config.driver === ARTIFACT_STORAGE_DRIVER_REGISTERED) {
    throw new Error(
      "Registered artifact storage driver requires resolveArtifactBlobStore(). " +
        "Set OSVA_ARTIFACT_STORAGE_DRIVER=filesystem or s3 for synchronous startup, " +
        "or inject artifactBlobStore through process dependencies.",
    );
  }

  return createBuiltInArtifactBlobStore(config);
}

export async function resolveArtifactBlobStoreFromConfig(
  config: ArtifactStorageConfig,
): Promise<ArtifactBlobStore> {
  return resolveArtifactBlobStore(config, createBuiltInArtifactBlobStore);
}
