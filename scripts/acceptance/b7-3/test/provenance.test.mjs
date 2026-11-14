import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CONNECTOR_STDIO_ENTRY_RELATIVE,
  GA4_CONNECTOR_PACKAGE,
  GA4_CONNECTOR_VERSION,
  SHOPIFY_CONNECTOR_PACKAGE,
  SHOPIFY_CONNECTOR_VERSION,
} from "../constants.mjs";
import {
  assertProvenance,
  readInstalledProvenance,
  resolvePublishedStdioEntry,
} from "../lib/provenance.mjs";

test("resolvePublishedStdioEntry requires dist/stdio.js", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "osva-b7-3-prov-"));
  for (const pkg of [SHOPIFY_CONNECTOR_PACKAGE, GA4_CONNECTOR_PACKAGE]) {
    const entryDir = path.join(
      root,
      "node_modules",
      pkg,
      path.dirname(CONNECTOR_STDIO_ENTRY_RELATIVE),
    );
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(
      path.join(entryDir, path.basename(CONNECTOR_STDIO_ENTRY_RELATIVE)),
      "export {};\n",
    );
  }
  assert.equal(
    resolvePublishedStdioEntry(root, SHOPIFY_CONNECTOR_PACKAGE),
    path.resolve(
      root,
      "node_modules",
      SHOPIFY_CONNECTOR_PACKAGE,
      CONNECTOR_STDIO_ENTRY_RELATIVE,
    ),
  );
  assert.equal(
    resolvePublishedStdioEntry(root, GA4_CONNECTOR_PACKAGE),
    path.resolve(
      root,
      "node_modules",
      GA4_CONNECTOR_PACKAGE,
      CONNECTOR_STDIO_ENTRY_RELATIVE,
    ),
  );
});

test("assertProvenance rejects version mismatch", () => {
  assert.throws(() =>
    assertProvenance({
      shopifyVersion: "0.0.0",
      ga4Version: GA4_CONNECTOR_VERSION,
    }),
  );
  assertProvenance({
    shopifyVersion: SHOPIFY_CONNECTOR_VERSION,
    ga4Version: GA4_CONNECTOR_VERSION,
    connectorSdkVersion: "1.1.4",
    shopifyRegistryMatchesPin: true,
    ga4RegistryMatchesPin: true,
    expectedShopifyVersion: SHOPIFY_CONNECTOR_VERSION,
    expectedGa4Version: GA4_CONNECTOR_VERSION,
    expectedConnectorSdkVersion: "1.1.4",
  });
});

test("readInstalledProvenance reads dual consumer tree", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "osva-b7-3-prov-read-"));
  for (const pkg of [
    [SHOPIFY_CONNECTOR_PACKAGE, SHOPIFY_CONNECTOR_VERSION],
    [GA4_CONNECTOR_PACKAGE, GA4_CONNECTOR_VERSION],
  ]) {
    const dir = path.join(root, "node_modules", pkg[0]);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      `${JSON.stringify({ name: pkg[0], version: pkg[1], engines: { node: ">=24" } })}\n`,
    );
  }
  const sdkDir = path.join(root, "node_modules", "@osva-ai", "connector-sdk");
  fs.mkdirSync(sdkDir, { recursive: true });
  fs.writeFileSync(
    path.join(sdkDir, "package.json"),
    `${JSON.stringify({ name: "@osva-ai/connector-sdk", version: "1.1.4" })}\n`,
  );
  const provenance = readInstalledProvenance(root);
  assert.equal(provenance.shopifyVersion, SHOPIFY_CONNECTOR_VERSION);
  assert.equal(provenance.ga4Version, GA4_CONNECTOR_VERSION);
});
