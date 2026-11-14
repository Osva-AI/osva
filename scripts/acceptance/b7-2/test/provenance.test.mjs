import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GITHUB_CONNECTOR_PACKAGE,
  GITHUB_CONNECTOR_STDIO_ENTRY_RELATIVE,
  GITHUB_CONNECTOR_VERSION,
} from "../constants.mjs";
import {
  assertProvenance,
  readInstalledProvenance,
  resolvePublishedGithubStdioEntry,
} from "../lib/provenance.mjs";

test("resolvePublishedGithubStdioEntry requires dist/stdio.js", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "osva-b7-2-prov-"));
  const entryDir = path.join(
    root,
    "node_modules",
    GITHUB_CONNECTOR_PACKAGE,
    path.dirname(GITHUB_CONNECTOR_STDIO_ENTRY_RELATIVE),
  );
  fs.mkdirSync(entryDir, { recursive: true });
  const entry = path.join(
    entryDir,
    path.basename(GITHUB_CONNECTOR_STDIO_ENTRY_RELATIVE),
  );
  fs.writeFileSync(entry, "export {};\n");
  assert.equal(resolvePublishedGithubStdioEntry(root), path.resolve(entry));
});

test("assertProvenance rejects version mismatch", () => {
  assert.throws(() =>
    assertProvenance({
      connectorVersion: "0.0.0",
    }),
  );
  assertProvenance({
    connectorVersion: GITHUB_CONNECTOR_VERSION,
    connectorSdkVersion: "1.1.4",
    registryVersionMatchesPin: true,
    expectedConnectorVersion: GITHUB_CONNECTOR_VERSION,
    expectedConnectorSdkVersion: "1.1.4",
  });
});
