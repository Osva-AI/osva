import path from "node:path";

export const ARTIFACT_STORAGE_DRIVER_FILESYSTEM = "filesystem" as const;
export const ARTIFACT_STORAGE_DRIVER_S3 = "s3" as const;

export type ArtifactStorageDriver =
  typeof ARTIFACT_STORAGE_DRIVER_FILESYSTEM | typeof ARTIFACT_STORAGE_DRIVER_S3;

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

export type ArtifactStorageConfig =
  ArtifactStorageConfigFilesystem | ArtifactStorageConfigS3;

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

  throw new Error(
    `Unsupported OSVA_ARTIFACT_STORAGE_DRIVER '${driverRaw}'. Supported values: filesystem, s3.`,
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
