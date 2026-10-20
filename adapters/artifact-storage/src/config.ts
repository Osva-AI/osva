import path from "node:path";

import {
  ARTIFACT_STORAGE_DRIVER_FILESYSTEM,
  ARTIFACT_STORAGE_DRIVER_REGISTERED,
  ARTIFACT_STORAGE_DRIVER_S3,
  DEFAULT_ARTIFACT_FILESYSTEM_ROOT,
  DEFAULT_ARTIFACT_MAX_BYTES,
  type ArtifactStorageConfig,
  type ArtifactStorageConfigFilesystem,
  type ArtifactStorageConfigRegistered,
  type ArtifactStorageConfigS3,
  type ArtifactStorageDriver,
} from "@osva-ai/contracts";

export {
  ARTIFACT_STORAGE_DRIVER_FILESYSTEM,
  ARTIFACT_STORAGE_DRIVER_REGISTERED,
  ARTIFACT_STORAGE_DRIVER_S3,
  DEFAULT_ARTIFACT_FILESYSTEM_ROOT,
  DEFAULT_ARTIFACT_MAX_BYTES,
  type ArtifactStorageConfig,
  type ArtifactStorageConfigFilesystem,
  type ArtifactStorageConfigRegistered,
  type ArtifactStorageConfigS3,
  type ArtifactStorageDriver,
};

export function loadArtifactStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): ArtifactStorageConfig {
  const maxBytes = parseMaxBytes(env.OSVA_ARTIFACT_MAX_BYTES);
  const driverRaw =
    readOptional(env.OSVA_ARTIFACT_STORAGE_DRIVER)?.toLowerCase() ??
    ARTIFACT_STORAGE_DRIVER_FILESYSTEM;

  if (driverRaw === ARTIFACT_STORAGE_DRIVER_FILESYSTEM) {
    return {
      driver: ARTIFACT_STORAGE_DRIVER_FILESYSTEM,
      filesystemRoot: path.resolve(
        readOptional(env.OSVA_ARTIFACT_FILESYSTEM_ROOT) ??
          DEFAULT_ARTIFACT_FILESYSTEM_ROOT,
      ),
      maxBytes,
    };
  }

  if (driverRaw === ARTIFACT_STORAGE_DRIVER_S3) {
    const bucket = readRequired(env.OSVA_ARTIFACT_S3_BUCKET);
    const region =
      readOptional(env.OSVA_ARTIFACT_S3_REGION) ??
      readOptional(env.AWS_REGION) ??
      readOptional(env.AWS_DEFAULT_REGION) ??
      "us-east-1";

    return {
      driver: ARTIFACT_STORAGE_DRIVER_S3,
      maxBytes,
      bucket,
      region,
      endpoint: readOptional(env.OSVA_ARTIFACT_S3_ENDPOINT),
      accessKeyId: readOptional(env.OSVA_ARTIFACT_S3_ACCESS_KEY_ID),
      secretAccessKey: readOptional(env.OSVA_ARTIFACT_S3_SECRET_ACCESS_KEY),
      forcePathStyle: readBoolean(env.OSVA_ARTIFACT_S3_FORCE_PATH_STYLE),
    };
  }

  if (driverRaw === ARTIFACT_STORAGE_DRIVER_REGISTERED) {
    const registerModule = readRequired(
      env.OSVA_ARTIFACT_BLOB_STORE_REGISTER_MODULE,
    );
    return {
      driver: ARTIFACT_STORAGE_DRIVER_REGISTERED,
      maxBytes,
      registerModule,
    };
  }

  throw new Error(
    `Unsupported OSVA_ARTIFACT_STORAGE_DRIVER '${driverRaw}'. Supported values: filesystem, s3, registered.`,
  );
}

function parseMaxBytes(value: string | undefined): number {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return DEFAULT_ARTIFACT_MAX_BYTES;
  }

  if (!/^\d+$/.test(trimmed)) {
    throw new Error("OSVA_ARTIFACT_MAX_BYTES must be a non-negative integer.");
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < 0) {
    throw new Error("OSVA_ARTIFACT_MAX_BYTES must be a non-negative integer.");
  }

  return parsed;
}

function readBoolean(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function readRequired(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new Error("Required artifact storage configuration is missing.");
  }
  return trimmed;
}

function readOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? undefined : trimmed;
}
