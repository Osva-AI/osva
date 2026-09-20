import { Readable } from "node:stream";

import type { ArtifactId } from "@osva/contracts";
import {
  ArtifactBlobUnavailableError,
  ArtifactDigestMismatchError,
  ArtifactPayloadTooLargeError,
  artifactBlobStorageKey,
  artifactIdFromBlobStorageKey,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { createS3ArtifactBlobStore } from "../src/s3-artifact-blob-store.js";
import { asS3Client, commandNameOf, FakeS3Client } from "./fake-s3-client.js";

describe("S3ArtifactBlobStore", () => {
  it("writes and reads bytes with digest", async () => {
    const { store, client } = createStore();
    const payload = Buffer.from([0, 1, 2, 255]);

    const written = await store.write({
      key: "v1/artifact-contract-1",
      content: Readable.from(payload),
      maxBytes: 4096,
    });

    expect(written.sizeBytes).toBe(payload.length);
    expect(written.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(client.objects.get("v1/artifact-contract-1")).toEqual(payload);
  });

  it("rejects payloads over maxBytes while streaming", async () => {
    const { store } = createStore();
    await expect(
      store.write({
        key: "v1/artifact-contract-big",
        content: Readable.from([Buffer.alloc(32)]),
        maxBytes: 16,
      }),
    ).rejects.toSatisfy(
      (error) => error instanceof ArtifactPayloadTooLargeError,
    );
  });

  it("rejects expected digest mismatch", async () => {
    const { store } = createStore();
    await expect(
      store.write({
        key: "v1/artifact-contract-mismatch",
        content: Readable.from([Buffer.from("abc")]),
        maxBytes: 4096,
        expectedDigest: `sha256:${"b".repeat(64)}`,
      }),
    ).rejects.toSatisfy(
      (error) => error instanceof ArtifactDigestMismatchError,
    );
  });

  it("reports missing objects as ArtifactBlobUnavailableError", async () => {
    const { store } = createStore();
    await expect(store.open("v1/missing-artifact-object")).rejects.toSatisfy(
      (error) =>
        error instanceof ArtifactBlobUnavailableError &&
        error.artifactId ===
          artifactIdFromBlobStorageKey("v1/missing-artifact-object"),
    );
  });

  it("uses the internal v1/{artifactId} key and ignores user filenames", async () => {
    const { store, client } = createStore();
    const artifactId = "artifact-123" as ArtifactId;
    const key = artifactBlobStorageKey(artifactId);

    await store.write({
      key,
      content: Readable.from([Buffer.from("payload")]),
      maxBytes: 4096,
    });

    expect(client.objects.has(key)).toBe(true);
    expect(client.objects.has("report.pdf")).toBe(false);
    expect([...client.objects.keys()]).toEqual([key]);
  });

  it("writes streamed input through the SDK client without pre-buffering in the store", async () => {
    const { store, client } = createStore();

    async function* generate() {
      yield Buffer.from("alpha-", "utf8");
      yield Buffer.from("beta-", "utf8");
      yield Buffer.from("gamma", "utf8");
    }

    await store.write({
      key: "v1/streaming-artifact",
      content: Readable.from(generate()),
      maxBytes: 4096,
    });

    const commandNames = client.commands.map((command) =>
      commandNameOf(command),
    );
    expect(
      commandNames.some(
        (name) => name === "PutObjectCommand" || name === "UploadPartCommand",
      ),
    ).toBe(true);
    expect(client.objects.get("v1/streaming-artifact")?.toString("utf8")).toBe(
      "alpha-beta-gamma",
    );
  });

  it("maps internal AWS failures to generic storage errors", async () => {
    const client = new FakeS3Client();
    client.send = async () => {
      throw new Error("AccessDenied for bucket secret-bucket key secret-key");
    };
    const store = createS3ArtifactBlobStore({
      bucket: "secret-bucket",
      region: "us-east-1",
      client: asS3Client(client),
    });

    await expect(
      store.write({
        key: "v1/secret-key",
        content: Readable.from([Buffer.from("x")]),
        maxBytes: 4096,
      }),
    ).rejects.toThrow("Artifact storage operation failed.");

    await expect(store.open("v1/secret-key")).rejects.toThrow(
      "Artifact storage operation failed.",
    );
  });
});

function createStore() {
  const client = new FakeS3Client();
  return {
    client,
    store: createS3ArtifactBlobStore({
      bucket: "test-bucket",
      region: "us-east-1",
      client: asS3Client(client),
    }),
  };
}
