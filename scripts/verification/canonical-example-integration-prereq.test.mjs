import assert from "node:assert/strict";
import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import { REPO_ROOT } from "./environment.mjs";

const PACKAGE_NAME = "@osva/example-canonical-dependency-adoption";
const EXAMPLE_ROOT = path.join(
  REPO_ROOT,
  "examples",
  "canonical-dependency-adoption",
);
const ANALYSIS_AGENT = path.join(
  EXAMPLE_ROOT,
  "dist",
  "agents",
  "analysis-agent.js",
);

describe("canonical example integration build prerequisite", () => {
  it("requires the package build task before test:integration in turbo", async () => {
    const turbo = JSON.parse(
      await readFile(path.join(REPO_ROOT, "turbo.json"), "utf8"),
    );
    const taskKey = `${PACKAGE_NAME}#test:integration`;
    const task = turbo.tasks?.[taskKey];
    assert.ok(task, `expected turbo task override ${taskKey}`);
    assert.deepEqual(
      task.dependsOn,
      ["build"],
      `${taskKey} must run this package's build (not only ^build)`,
    );
  });

  it("build script compiles agents into dist/agents", async () => {
    const pkg = JSON.parse(
      await readFile(path.join(EXAMPLE_ROOT, "package.json"), "utf8"),
    );
    assert.match(
      pkg.scripts.build,
      /tsconfig\.build\.agents\.json/,
      "build must emit agent entrypoints under dist/agents",
    );
    const agentsTsconfig = JSON.parse(
      await readFile(
        path.join(EXAMPLE_ROOT, "tsconfig.build.agents.json"),
        "utf8",
      ),
    );
    assert.equal(
      agentsTsconfig.compilerOptions.outDir.replace(/\\/g, "/"),
      "dist/agents",
    );
  });

  it("turbo schedules build before integration when agent artifacts are missing", async () => {
    await rm(path.join(EXAMPLE_ROOT, "dist", "agents"), {
      recursive: true,
      force: true,
    });

    const result = spawnSync(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      [
        "exec",
        "turbo",
        "run",
        "test:integration",
        "--filter",
        PACKAGE_NAME,
        "--dry-run=json",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        shell: process.platform === "win32",
      },
    );
    assert.equal(
      result.status,
      0,
      `turbo dry-run failed: ${result.stderr || result.stdout}`,
    );

    const jsonStart = result.stdout.indexOf("{");
    assert.ok(jsonStart >= 0, "expected turbo dry-run JSON on stdout");
    const dryRun = JSON.parse(result.stdout.slice(jsonStart));
    const tasks = dryRun.tasks ?? [];
    const buildTask = tasks.find(
      (entry) => entry.package === PACKAGE_NAME && entry.task === "build",
    );
    const integrationTask = tasks.find(
      (entry) =>
        entry.package === PACKAGE_NAME && entry.task === "test:integration",
    );
    assert.ok(buildTask, "expected canonical example build in dry-run graph");
    assert.ok(
      integrationTask,
      "expected canonical example test:integration in dry-run graph",
    );
    assert.match(
      buildTask.command,
      /tsconfig\.build\.agents\.json/,
      "build must compile agent entrypoints before integration",
    );
    assert.ok(
      integrationTask.dependencies.includes(`${PACKAGE_NAME}#build`),
      "integration must depend on this package's build, not only workspace ^build",
    );
  });

  it("package build emits analysis-agent.js deterministically", async () => {
    await rm(path.join(EXAMPLE_ROOT, "dist"), {
      recursive: true,
      force: true,
    });

    const result = spawnSync(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["exec", "turbo", "run", "build", "--filter", PACKAGE_NAME, "--force"],
      {
        cwd: REPO_ROOT,
        stdio: "pipe",
        encoding: "utf8",
        shell: process.platform === "win32",
      },
    );
    assert.equal(
      result.status,
      0,
      `build failed: ${result.stderr || result.stdout}`,
    );
    await access(ANALYSIS_AGENT);
  });
});
