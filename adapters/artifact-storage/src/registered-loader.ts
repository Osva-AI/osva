import {
  ARTIFACT_STORAGE_DRIVER_REGISTERED,
  type ArtifactBlobStore,
  type ArtifactStorageConfig,
  type ArtifactStorageConfigRegistered,
  type RegisteredArtifactBlobStoreModule,
} from "@osva-ai/contracts";

export function assertArtifactBlobStore(
  value: unknown,
): asserts value is ArtifactBlobStore {
  if (value === null || typeof value !== "object") {
    throw new Error(
      "Registered artifact blob store factory returned invalid value.",
    );
  }
  const store = value as ArtifactBlobStore;
  if (typeof store.write !== "function") {
    throw new Error("Registered artifact blob store must implement write().");
  }
  if (typeof store.open !== "function") {
    throw new Error("Registered artifact blob store must implement open().");
  }
  if (typeof store.delete !== "function") {
    throw new Error("Registered artifact blob store must implement delete().");
  }
}

export async function loadRegisteredArtifactBlobStore(
  config: ArtifactStorageConfigRegistered,
): Promise<ArtifactBlobStore> {
  let imported: unknown;
  try {
    imported = await import(config.registerModule);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown import error";
    throw new Error(
      `Failed to import registered artifact blob store module '${config.registerModule}': ${message}`,
    );
  }

  const moduleShape = imported as Partial<RegisteredArtifactBlobStoreModule>;
  if (typeof moduleShape.createArtifactBlobStore !== "function") {
    throw new Error(
      `Registered artifact blob store module '${config.registerModule}' must export createArtifactBlobStore().`,
    );
  }

  const store = await moduleShape.createArtifactBlobStore(config);
  assertArtifactBlobStore(store);
  return store;
}

export async function resolveArtifactBlobStore(
  config: ArtifactStorageConfig,
  builtIn: (
    config: Exclude<
      ArtifactStorageConfig,
      { driver: typeof ARTIFACT_STORAGE_DRIVER_REGISTERED }
    >,
  ) => ArtifactBlobStore,
): Promise<ArtifactBlobStore> {
  if (config.driver === ARTIFACT_STORAGE_DRIVER_REGISTERED) {
    return loadRegisteredArtifactBlobStore(config);
  }
  return builtIn(config);
}
