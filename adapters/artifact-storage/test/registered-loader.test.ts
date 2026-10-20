import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ARTIFACT_STORAGE_DRIVER_REGISTERED,
  type ArtifactBlobStore,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  assertArtifactBlobStore,
  loadRegisteredArtifactBlobStore,
  resolveArtifactBlobStoreFromConfig,
} from "../src/index.js";

const fixtureModuleUrl = pathToFileURL(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "fixtures",
    "registered-memory-blob-store.js",
  ),
).href;

describe("registered artifact blob store loader", () => {
  it("rejects modules without createArtifactBlobStore", async () => {
    const invalidModule = pathToFileURL(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "fixtures",
        "registered-invalid-module.js",
      ),
    ).href;

    await expect(
      loadRegisteredArtifactBlobStore({
        driver: ARTIFACT_STORAGE_DRIVER_REGISTERED,
        maxBytes: 1024,
        registerModule: invalidModule,
      }),
    ).rejects.toThrow(/must export createArtifactBlobStore/);
  });

  it("loads a registered module and performs write/open/delete", async () => {
    const store = await loadRegisteredArtifactBlobStore({
      driver: ARTIFACT_STORAGE_DRIVER_REGISTERED,
      maxBytes: 1024,
      registerModule: fixtureModuleUrl,
    });

    const key = "workspace/ws/artifact/a1";
    const body = Buffer.from("external-adapter-proof");
    const writeResult = await store.write({
      key,
      content: Readable.from([body]),
      maxBytes: 1024,
    });
    expect(writeResult.sizeBytes).toBe(body.length);
    expect(writeResult.digest).toMatch(/^sha256:/);

    const handle = await store.open(key);
    expect(handle.sizeBytes).toBe(body.length);

    await store.delete(key);
    await expect(store.open(key)).rejects.toThrow(/not found/i);
  });

  it("resolveArtifactBlobStoreFromConfig keeps filesystem default", async () => {
    const store = await resolveArtifactBlobStoreFromConfig({
      driver: "filesystem",
      filesystemRoot: path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        ".tmp-artifacts",
      ),
      maxBytes: 4096,
    });
    assertArtifactBlobStore(store);
    expect(typeof (store as ArtifactBlobStore).write).toBe("function");
  });

  it("createArtifactBlobStore fails clearly for registered driver", async () => {
    const { createArtifactBlobStore } = await import("../src/factory.js");
    expect(() =>
      createArtifactBlobStore({
        driver: ARTIFACT_STORAGE_DRIVER_REGISTERED,
        maxBytes: 1,
        registerModule: fixtureModuleUrl,
      }),
    ).toThrow(/resolveArtifactBlobStore/);
  });
});
