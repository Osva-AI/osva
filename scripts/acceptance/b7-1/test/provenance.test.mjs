import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  NPM_CONNECTOR_PACKAGE,
  NPM_CONNECTOR_STDIO_ENTRY_RELATIVE,
  NPM_CONNECTOR_VERSION,
} from "../constants.mjs";
import {
  assertProvenance,
  readInstalledProvenance,
  resolvePublishedNpmStdioEntry,
} from "../lib/provenance.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("resolvePublishedNpmStdioEntry requires dist/stdio.js", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "osva-b7-1-prov-"));
  const entryDir = path.join(
    root,
    "node_modules",
    NPM_CONNECTOR_PACKAGE,
    path.dirname(NPM_CONNECTOR_STDIO_ENTRY_RELATIVE),
  );
  fs.mkdirSync(entryDir, { recursive: true });
  const entry = path.join(
    entryDir,
    path.basename(NPM_CONNECTOR_STDIO_ENTRY_RELATIVE),
  );
  fs.writeFileSync(entry, "export {};\n");
  const resolved = resolvePublishedNpmStdioEntry(root);
  assert.equal(resolved, path.resolve(entry));
});

test("assertProvenance rejects version mismatch", () => {
  assert.throws(() =>
    assertProvenance({
      connectorVersion: "0.0.0",
    }),
  );
  assertProvenance({
    connectorVersion: NPM_CONNECTOR_VERSION,
    connectorSdkVersion: "1.1.4",
  });
});
