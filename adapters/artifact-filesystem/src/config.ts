import path from "node:path";

export const DEFAULT_ARTIFACT_STORAGE_DRIVER = "filesystem" as const;
export const DEFAULT_ARTIFACT_FILESYSTEM_ROOT = ".osva/artifacts";
export const DEFAULT_ARTIFACT_MAX_BYTES = 67_108_864;

export interface ArtifactStorageConfig {
  readonly driver: typeof DEFAULT_ARTIFACT_STORAGE_DRIVER;
  readonly filesystemRoot: string;
  readonly maxBytes: number;
}

/**
 * @deprecated Prefer `loadArtifactStorageConfig` from `@osva/adapters-artifact-storage`.
 */
export function loadArtifactStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): ArtifactStorageConfig {
  const driver = readOptional(env.OSVA_ARTIFACT_STORAGE_DRIVER)?.toLowerCase();
  if (driver !== undefined && driver !== DEFAULT_ARTIFACT_STORAGE_DRIVER) {
    throw new Error(
      `Unsupported OSVA_ARTIFACT_STORAGE_DRIVER '${driver}'. Use @osva/adapters-artifact-storage for S3.`,
    );
  }

  const filesystemRoot = path.resolve(
    readOptional(env.OSVA_ARTIFACT_FILESYSTEM_ROOT) ??
      DEFAULT_ARTIFACT_FILESYSTEM_ROOT,
  );
  const maxBytes = parseMaxBytes(env.OSVA_ARTIFACT_MAX_BYTES);

  return {
    driver: DEFAULT_ARTIFACT_STORAGE_DRIVER,
    filesystemRoot,
    maxBytes,
  };
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

function readOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? undefined : trimmed;
}
