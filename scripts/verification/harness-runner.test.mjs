import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  HARNESS_TEST_CONCURRENCY,
  harnessNodeTestArgv,
  listHarnessTestFiles,
} from "./harness-runner.mjs";

describe("verification harness runner", () => {
  it("runs harness test files with serial file concurrency", () => {
    assert.equal(HARNESS_TEST_CONCURRENCY, 1);
    const argv = harnessNodeTestArgv([
      path.join("scripts", "verification", "example.test.mjs"),
    ]);
    assert.equal(argv[0], "--test");
    assert.equal(argv[1], "--test-concurrency=1");
    assert.match(argv[1], /^--test-concurrency=1$/);
  });

  it("includes canonical example prerequisite tests in the harness file list", async () => {
    const files = await listHarnessTestFiles();
    assert.ok(
      files.some((file) =>
        file
          .replaceAll("\\", "/")
          .endsWith("canonical-example-integration-prereq.test.mjs"),
      ),
      "canonical example integration prerequisite must stay in harness",
    );
  });
});
