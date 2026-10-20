import { describe, expect, it } from "vitest";

import { loadArtifactStorageConfig } from "../src/config.js";

describe("loadArtifactStorageConfig", () => {
  it("parses registered driver with explicit module specifier", () => {
    const config = loadArtifactStorageConfig({
      OSVA_ARTIFACT_STORAGE_DRIVER: "registered",
      OSVA_ARTIFACT_BLOB_STORE_REGISTER_MODULE: "file:///tmp/custom-store.js",
    });
    expect(config.driver).toBe("registered");
    if (config.driver !== "registered") {
      throw new Error("expected registered driver");
    }
    expect(config.registerModule).toBe("file:///tmp/custom-store.js");
  });

  it("fails when registered driver omits module specifier", () => {
    expect(() =>
      loadArtifactStorageConfig({
        OSVA_ARTIFACT_STORAGE_DRIVER: "registered",
      }),
    ).toThrow(/Required artifact storage configuration is missing/);
  });

  it("fails for unknown drivers", () => {
    expect(() =>
      loadArtifactStorageConfig({
        OSVA_ARTIFACT_STORAGE_DRIVER: "azure-blob",
      }),
    ).toThrow(/Unsupported OSVA_ARTIFACT_STORAGE_DRIVER/);
  });
});
