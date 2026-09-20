import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ArtifactBlobUnavailableError,
  ArtifactDigestMismatchError,
  ArtifactPayloadTooLargeError,
  artifactIdFromBlobStorageKey,
} from "@osva/domain";

import {
  createFilesystemArtifactBlobStore,
  readableFromBuffer,
} from "../src/filesystem-artifact-blob-store.js";

describe("FilesystemArtifactBlobStore", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { force: true, recursive: true })),
    );
  });

  it("writes and reads bytes with digest", async () => {
    const store = await createStore();
    const payload = Buffer.from([0, 1, 2, 255]);

    const written = await store.write({
      key: "v1/artifact-1",
      content: readableFromBuffer(payload),
      maxBytes: 1024,
    });

    expect(written.sizeBytes).toBe(payload.length);
    const opened = await store.open("v1/artifact-1");
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(payload);
  });

  it("enforces max bytes", async () => {
    const store = await createStore();
    await expect(
      store.write({
        key: "v1/big",
        content: readableFromBuffer(Buffer.alloc(32)),
        maxBytes: 16,
      }),
    ).rejects.toSatisfy(
      (error) => error instanceof ArtifactPayloadTooLargeError,
    );
  });

  it("rejects digest mismatch", async () => {
    const store = await createStore();
    await expect(
      store.write({
        key: "v1/mismatch",
        content: readableFromBuffer(Buffer.from("abc")),
        maxBytes: 1024,
        expectedDigest: `sha256:${"b".repeat(64)}`,
      }),
    ).rejects.toSatisfy(
      (error) => error instanceof ArtifactDigestMismatchError,
    );
  });

  it("reports missing objects as ArtifactBlobUnavailableError", async () => {
    const store = await createStore();
    await expect(store.open("v1/missing-artifact-object")).rejects.toSatisfy(
      (error) =>
        error instanceof ArtifactBlobUnavailableError &&
        error.artifactId ===
          artifactIdFromBlobStorageKey("v1/missing-artifact-object"),
    );
  });

  it("rejects path traversal keys", async () => {
    const store = await createStore();
    await expect(
      store.write({
        key: "../escape",
        content: readableFromBuffer(Buffer.from("x")),
        maxBytes: 1024,
      }),
    ).rejects.toThrow();
  });

  async function createStore() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-fs-"));
    roots.push(root);
    return createFilesystemArtifactBlobStore({ rootDirectory: root });
  }
});
