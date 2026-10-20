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

  it("loads registered filesystem fixture using OSVA_ARTIFACT_FILESYSTEM_ROOT", async () => {
    const root = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      ".tmp-registered-fs",
    );
    const fixtureModule = pathToFileURL(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "fixtures",
        "registered-filesystem-blob-store.js",
      ),
    ).href;
    process.env.OSVA_ARTIFACT_FILESYSTEM_ROOT = root;

    const store = await loadRegisteredArtifactBlobStore({
      driver: ARTIFACT_STORAGE_DRIVER_REGISTERED,
      maxBytes: 4096,
      registerModule: fixtureModule,
    });
    const key = "workspace/ws/artifact/fs-1";
    const body = Buffer.from("filesystem-registered-fixture");
    const writeResult = await store.write({
      key,
      content: Readable.from([body]),
      maxBytes: 4096,
    });
    expect(writeResult.sizeBytes).toBe(body.length);

    const handle = await store.open(key);
    const chunks: Buffer[] = [];
    for await (const chunk of handle.stream) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks).toString("utf8")).toBe(
      "filesystem-registered-fixture",
    );
    await store.delete(key);
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
