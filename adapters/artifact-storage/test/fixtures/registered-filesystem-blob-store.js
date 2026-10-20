import { createFilesystemArtifactBlobStore } from "@osva/adapters-artifact-filesystem";

/**
 * Registered adapter fixture backed by OSVA_ARTIFACT_FILESYSTEM_ROOT so worker,
 * web, and knowledge-worker processes share the same on-disk blob namespace.
 */
export function createArtifactBlobStore(config) {
  void config;
  const root = process.env.OSVA_ARTIFACT_FILESYSTEM_ROOT?.trim();
  if (root === undefined || root.length === 0) {
    throw new Error(
      "registered-filesystem-blob-store requires OSVA_ARTIFACT_FILESYSTEM_ROOT",
    );
  }
  return createFilesystemArtifactBlobStore({ rootDirectory: root });
}
