import { createHash } from "node:crypto";
import { Readable } from "node:stream";

/** @type {Map<string, { sizeBytes: number, digest: string, body: Buffer }>} */
const blobs = new Map();

/** @param {import("@osva-ai/contracts").ArtifactStorageConfigRegistered} config */
export function createArtifactBlobStore(config) {
  void config;
  return {
    async write(input) {
      const chunks = [];
      for await (const chunk of input.content) {
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);
      if (body.length > input.maxBytes) {
        throw new Error("payload too large");
      }
      const digest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
      blobs.set(input.key, { sizeBytes: body.length, digest, body });
      return { sizeBytes: body.length, digest };
    },
    async open(key) {
      const entry = blobs.get(key);
      if (entry === undefined) {
        throw new Error(`blob not found: ${key}`);
      }
      return {
        sizeBytes: entry.sizeBytes,
        stream: Readable.from([entry.body]),
      };
    },
    async delete(key) {
      blobs.delete(key);
    },
  };
}
