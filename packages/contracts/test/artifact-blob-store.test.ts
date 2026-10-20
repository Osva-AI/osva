import { describe, expect, it } from "vitest";

import type {
  ArtifactBlobStore,
  ArtifactStorageConfigRegistered,
  RegisteredArtifactBlobStoreModule,
} from "../src/index.js";

describe("ArtifactBlobStore public port", () => {
  it("accepts a minimal structural implementation", () => {
    const store: ArtifactBlobStore = {
      write: async () => ({ sizeBytes: 0, digest: "sha256:abc" }),
      open: async () => ({
        sizeBytes: 0,
        stream: undefined as never,
      }),
      delete: async () => {},
    };
    expect(typeof store.write).toBe("function");
  });

  it("types registered module factory against public config", () => {
    const module: RegisteredArtifactBlobStoreModule = {
      createArtifactBlobStore: (
        config: ArtifactStorageConfigRegistered,
      ): ArtifactBlobStore => ({
        write: async () => ({
          sizeBytes: 0,
          digest: "sha256:registered",
        }),
        open: async () => ({
          sizeBytes: config.maxBytes,
          stream: undefined as never,
        }),
        delete: async () => {},
      }),
    };
    expect(module.createArtifactBlobStore).toBeDefined();
  });
});
