import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  LITELLM_PROXY_IMAGE,
  LITELLM_PROXY_IMAGE_DIGEST,
  MODEL_ALIASES,
} from "../constants.mjs";

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/litellm-acceptance-config.yaml",
);

test("pinned litellm image is not latest", () => {
  assert.ok(!LITELLM_PROXY_IMAGE.endsWith(":latest"));
  assert.match(LITELLM_PROXY_IMAGE, /main-v1\.63\.11-stable$/);
  assert.match(LITELLM_PROXY_IMAGE_DIGEST, /^sha256:/);
});

test("acceptance config disables proxy retries on standard routes", () => {
  const yaml = readFileSync(FIXTURE, "utf8");
  assert.match(yaml, /num_retries: 0/);
  assert.doesNotMatch(yaml, /fallbacks:/);
  for (const alias of MODEL_ALIASES) {
    assert.match(yaml, new RegExp(`model_name: ${alias}`));
  }
});

test("retry-risk route documents operator hazard", () => {
  const yaml = readFileSync(FIXTURE, "utf8");
  assert.match(yaml, /litellm-proxy-retry-risk/);
  assert.match(yaml, /num_retries: 12/);
});
