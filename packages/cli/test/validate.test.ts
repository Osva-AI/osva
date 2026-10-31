import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runInit } from "../src/init/run-init.js";
import { runValidatePipeline } from "../src/validate/run-validate.js";
import { validateExitCode } from "../src/validate/exit-code.js";
import {
  removeTempDir,
  runCliSubprocess,
} from "./helpers/run-cli-subprocess.js";

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop();
    if (dir !== undefined) {
      await removeTempDir(dir);
    }
  }
});

async function makeTempRoot(label = "osva-validate"): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `${label}-`));
  tempRoots.push(dir);
  return dir;
}

function runCli(
  args: readonly string[],
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return runCliSubprocess(args, {
    cwd,
    env: {
      OSVA_API_KEY: "",
      OSVA_BASE_URL: "",
    },
  });
}

function runNpm(
  args: readonly string[],
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(npmCmd, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function createBuiltProject(
  parentDir: string,
  projectName: string,
): Promise<string> {
  const init = await runInit({ projectName, cwd: parentDir });
  expect(init.ok).toBe(true);
  if (!init.ok) {
    throw new Error("init failed");
  }
  const projectDir = init.projectDir;
  const install = await runNpm(
    ["install", "--no-fund", "--no-audit"],
    projectDir,
  );
  expect(install.code).toBe(0);
  const build = await runNpm(["run", "build"], projectDir);
  expect(build.code).toBe(0);
  const manifest = await runNpm(["run", "manifest"], projectDir);
  expect(manifest.code).toBe(0);
  return projectDir;
}

describe("osva validate", () => {
  it("passes for a fresh built scaffold", async () => {
    const parent = await makeTempRoot();
    const projectDir = await createBuiltProject(parent, "valid-agent");
    const report = await runValidatePipeline(projectDir);
    expect(report.result).toBe("pass");
    expect(validateExitCode(report)).toBe(0);
    expect(report.checks.some((check) => check.status === "FAIL")).toBe(false);
  }, 120_000);

  it("fails when project config is missing", async () => {
    const parent = await makeTempRoot();
    const projectDir = await createBuiltProject(parent, "no-config");
    await rm(path.join(projectDir, "osva-agent.project.json"));
    const report = await runValidatePipeline(projectDir);
    expect(report.result).toBe("fail");
    expect(
      report.checks.find((check) => check.id === "project_config")?.status,
    ).toBe("FAIL");
  }, 120_000);

  it("fails when manifest is missing", async () => {
    const parent = await makeTempRoot();
    const projectDir = await createBuiltProject(parent, "no-manifest");
    await rm(path.join(projectDir, "osva.manifest.json"));
    const report = await runValidatePipeline(projectDir);
    expect(
      report.checks.find((check) => check.id === "manifest_file")?.status,
    ).toBe("FAIL");
  }, 120_000);

  it("fails when the executable is missing", async () => {
    const parent = await makeTempRoot();
    const projectDir = await createBuiltProject(parent, "no-exe");
    await rm(path.join(projectDir, "dist", "agent", "no-exe.js"));
    const report = await runValidatePipeline(projectDir);
    expect(
      report.checks.find((check) => check.id === "build_artifact")?.status,
    ).toBe("FAIL");
  }, 120_000);

  it("fails when manifest integrity is incorrect", async () => {
    const parent = await makeTempRoot();
    const projectDir = await createBuiltProject(parent, "bad-digest");
    const manifestPath = path.join(projectDir, "osva.manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      runtime: { integrity: string };
    };
    manifest.runtime.integrity = `sha256:${"0".repeat(64)}`;
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    const report = await runValidatePipeline(projectDir);
    expect(
      report.checks.find((check) => check.id === "artifact_integrity")?.status,
    ).toBe("FAIL");
  }, 120_000);

  it("fails when the executable changes after manifest generation", async () => {
    const parent = await makeTempRoot();
    const projectDir = await createBuiltProject(parent, "stale-manifest");
    const artifactPath = path.join(
      projectDir,
      "dist",
      "agent",
      "stale-manifest.js",
    );
    await writeFile(artifactPath, "export async function run(){}\n", "utf8");
    const report = await runValidatePipeline(projectDir);
    expect(
      report.checks.find((check) => check.id === "artifact_integrity")?.status,
    ).toBe("FAIL");
  }, 120_000);

  it("fails when a contract schema is invalid JSON Schema", async () => {
    const parent = await makeTempRoot();
    const projectDir = await createBuiltProject(parent, "bad-schema");
    await writeFile(
      path.join(projectDir, "contracts", "input.v1.schema.json"),
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: 123,
      }),
      "utf8",
    );
    const report = await runValidatePipeline(projectDir);
    expect(
      report.checks.find((check) => check.id === "input_schema")?.status,
    ).toBe("FAIL");
  }, 120_000);

  it("fails when manifest fields violate AgentManifestV1", async () => {
    const parent = await makeTempRoot();
    const projectDir = await createBuiltProject(parent, "bad-manifest");
    await writeFile(
      path.join(projectDir, "osva.manifest.json"),
      JSON.stringify({ schemaVersion: "9", key: "x" }),
      "utf8",
    );
    const report = await runValidatePipeline(projectDir);
    expect(
      report.checks.find((check) => check.id === "manifest_schema")?.status,
    ).toBe("FAIL");
  }, 120_000);

  it("fails when project config disagrees with manifest", async () => {
    const parent = await makeTempRoot();
    const projectDir = await createBuiltProject(parent, "mismatch");
    const projectPath = path.join(projectDir, "osva-agent.project.json");
    const project = JSON.parse(await readFile(projectPath, "utf8")) as {
      key: string;
    };
    project.key = "other-key";
    await writeFile(
      projectPath,
      `${JSON.stringify(project, null, 2)}\n`,
      "utf8",
    );
    const report = await runValidatePipeline(projectDir);
    expect(
      report.checks.find((check) => check.id === "project_manifest_agreement")
        ?.status,
    ).toBe("FAIL");
  }, 120_000);

  it("fails when contract paths traverse outside the project", async () => {
    const parent = await makeTempRoot();
    const projectDir = await createBuiltProject(parent, "traversal");
    const projectPath = path.join(projectDir, "osva-agent.project.json");
    const project = JSON.parse(await readFile(projectPath, "utf8")) as {
      contracts: { input: string };
    };
    project.contracts.input = "../outside.json";
    await writeFile(
      projectPath,
      `${JSON.stringify(project, null, 2)}\n`,
      "utf8",
    );
    const report = await runValidatePipeline(projectDir);
    expect(
      report.checks.find((check) => check.id === "input_schema")?.status,
    ).toBe("FAIL");
  }, 120_000);

  it("fails when the build artifact symlink escapes dist/agent", async () => {
    const parent = await makeTempRoot();
    const outsideDir = path.join(parent, "outside");
    await mkdir(outsideDir, { recursive: true });
    const outsideFile = path.join(outsideDir, "payload.js");
    await writeFile(outsideFile, "export async function run(){}\n", "utf8");

    const projectDir = await createBuiltProject(parent, "symlink-escape");
    const artifactPath = path.join(
      projectDir,
      "dist",
      "agent",
      "symlink-escape.js",
    );
    await unlink(artifactPath);
    try {
      await symlink(outsideFile, artifactPath);
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? (error as NodeJS.ErrnoException).code
          : undefined;
      if (code === "EPERM" || code === "ENOENT") {
        return;
      }
      throw error;
    }

    const report = await runValidatePipeline(projectDir);
    expect(
      report.checks.find((check) => check.id === "artifact_path_safety")
        ?.status,
    ).toBe("FAIL");
  }, 120_000);

  it("works for project directories whose path contains spaces", async () => {
    const parent = await makeTempRoot();
    const spaced = path.join(parent, "space dir");
    await mkdir(spaced, { recursive: true });
    const projectDir = await createBuiltProject(spaced, "space-agent");
    const report = await runValidatePipeline(projectDir);
    expect(report.result).toBe("pass");
  }, 120_000);

  it("emits stable JSON and exit codes via CLI", async () => {
    const parent = await makeTempRoot();
    const projectDir = await createBuiltProject(parent, "json-agent");
    const pass = await runCli(["validate", "--json"], projectDir);
    expect(pass.code).toBe(0);
    expect(pass.stderr).toBe("");
    const payload = JSON.parse(pass.stdout) as {
      result: string;
      projectDir: string;
      checks: Array<{ id: string; status: string }>;
    };
    expect(payload.result).toBe("pass");
    expect(payload.projectDir).toBe(projectDir);
    expect(payload.checks.length).toBeGreaterThan(0);

    await rm(path.join(projectDir, "osva.manifest.json"));
    const fail = await runCli(["validate", "--json"], projectDir);
    expect(fail.code).toBe(1);
    const failPayload = JSON.parse(fail.stdout) as { result: string };
    expect(failPayload.result).toBe("fail");
  }, 120_000);

  it("supports --project and fails for missing directories", async () => {
    const parent = await makeTempRoot();
    const projectDir = await createBuiltProject(parent, "flag-agent");
    const pass = await runCli(
      ["validate", "--project", projectDir, "--json"],
      parent,
    );
    expect(pass.code).toBe(0);

    const missing = await runCli(
      ["validate", "--project", path.join(parent, "missing"), "--json"],
      parent,
    );
    expect(missing.code).toBe(1);
    const payload = JSON.parse(missing.stdout) as {
      checks: Array<{ id: string; status: string }>;
    };
    expect(payload.checks[0]?.id).toBe("project_directory");
    expect(payload.checks[0]?.status).toBe("FAIL");
  }, 120_000);

  it("runs compiled CLI validate against an isolated temp project", async () => {
    const parent = await makeTempRoot("outside-repo");
    const projectDir = await createBuiltProject(parent, "isolated-agent");
    const result = await runCli(["validate"], projectDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("OSVA Validate");
    expect(result.stdout).toContain("PASS");
    expect(result.stdout).not.toMatch(/osva_ak_/);
  }, 120_000);
});
