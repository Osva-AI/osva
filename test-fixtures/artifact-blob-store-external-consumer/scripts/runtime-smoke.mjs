import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";

const root = await mkdtemp(path.join(os.tmpdir(), "osva-external-adapter-"));
process.env.OSVA_ARTIFACT_FILESYSTEM_ROOT = root;

const moduleUrl = pathToFileURL(
  path.resolve("dist/filesystem-artifact-blob-store.js"),
).href;
const { createArtifactBlobStore } = await import(moduleUrl);
const store = createArtifactBlobStore({
  driver: "registered",
  maxBytes: 4096,
  registerModule: moduleUrl,
});

const key = "workspace/ws/artifact/external-packaged";
const body = Buffer.from("external-packaged-adapter-smoke");
await store.write({
  key,
  content: Readable.from([body]),
  maxBytes: 4096,
});
const handle = await store.open(key);
const chunks = [];
for await (const chunk of handle.stream) {
  chunks.push(Buffer.from(chunk));
}
if (Buffer.concat(chunks).compare(body) !== 0) {
  throw new Error("External adapter readback mismatch");
}
await store.delete(key);
await rm(root, { recursive: true, force: true });
console.log("External packaged artifact adapter runtime smoke passed.");
