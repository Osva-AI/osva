import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  assertExplicitDistTag,
  buildTarballPublishCommands,
} from "../lib/npm-publish-plan.mjs";

describe("npm publication safeguards", () => {
  it("requires explicit dist-tag and blocks accidental latest promotion", () => {
    assert.throws(
      () => assertExplicitDistTag(undefined),
      /Dist-tag is required/,
    );
    assert.throws(
      () => assertExplicitDistTag("latest"),
      /Refusing to publish with dist-tag "latest"/,
    );
    assert.equal(
      assertExplicitDistTag("latest", { allowLatest: true }),
      "latest",
    );
    assert.equal(assertExplicitDistTag("stable-candidate"), "stable-candidate");
  });

  it("generates npm publish commands that reference tarballs not directories", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "osva-publish-plan-"));
    const names = [
      ["@osva-ai/contracts", "osva-ai-contracts-1.1.0.tgz"],
      ["@osva-ai/runtime-protocol", "osva-ai-runtime-protocol-1.1.0.tgz"],
      ["@osva-ai/sdk", "osva-ai-sdk-1.1.0.tgz"],
      ["@osva-ai/connector-sdk", "osva-ai-connector-sdk-1.1.0.tgz"],
      ["@osva-ai/cli", "osva-ai-cli-1.1.0.tgz"],
    ];
    const packages = names.map(([name, fileName]) => {
      const tarballPath = path.join(tmp, fileName);
      fs.writeFileSync(tarballPath, "placeholder");
      return {
        name,
        tarballPath,
        fileName,
        sha256: "abc",
        dependencies: {},
      };
    });
    const record = { version: "1.1.0", packages };
    const commands = buildTarballPublishCommands(record, "stable-candidate");
    assert.equal(commands.length, 5);
    for (const command of commands) {
      assert.match(command, /^npm publish ".*\.tgz" --access public --tag /);
      assert.doesNotMatch(command, /packages\//);
    }
    assert.match(commands[0], /contracts-1\.1\.0\.tgz/);
  });
});
